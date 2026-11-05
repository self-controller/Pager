//! The one seam for outbound HTTP: the model's API, the catalogue lookups and the verifier's page
//! fetches all go through a `Transport`. The server uses `LiveTransport`; the app's default refuses
//! every request, so nothing reaches the network unless the binary asks for it; tests pass a fake.

use futures::future::BoxFuture;
use std::time::Duration;

/// Sent with every request. Generic on purpose: no email, no machine name.
pub const USER_AGENT: &str = "Pager/0.1 (personal reading app)";

#[derive(Clone, Debug)]
pub struct OutRequest {
    pub method: &'static str,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
    /// The body is cut off past this many bytes (and `truncated` set).
    pub max_bytes: usize,
}

impl OutRequest {
    pub fn get(url: impl Into<String>, timeout: Duration, max_bytes: usize) -> OutRequest {
        OutRequest { method: "GET", url: url.into(), headers: Vec::new(), body: None, timeout, max_bytes }
    }

    pub fn header(mut self, k: &str, v: &str) -> OutRequest {
        self.headers.push((k.to_string(), v.to_string()));
        self
    }
}

#[derive(Clone, Debug)]
pub struct OutResponse {
    pub status: u16,
    /// After redirects.
    pub url: String,
    pub content_type: String,
    pub body: Vec<u8>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutError {
    Timeout,
    Network(String),
    /// No transport is configured (tests, and any app built without one).
    Refused,
}

impl std::fmt::Display for OutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OutError::Timeout => f.write_str("timed out"),
            OutError::Network(m) => write!(f, "network error: {m}"),
            OutError::Refused => f.write_str("outbound requests are off"),
        }
    }
}

pub trait Transport: Send + Sync {
    fn send(&self, req: OutRequest) -> BoxFuture<'_, Result<OutResponse, OutError>>;
}

/// Refuses everything: the default until a binary installs `LiveTransport`.
pub struct NoTransport;

impl Transport for NoTransport {
    fn send(&self, _req: OutRequest) -> BoxFuture<'_, Result<OutResponse, OutError>> {
        Box::pin(async { Err(OutError::Refused) })
    }
}

/// reqwest over rustls, with the ring provider iroh already brings in.
pub struct LiveTransport {
    client: reqwest::Client,
}

impl LiveTransport {
    pub fn new() -> Result<LiveTransport, String> {
        // Ignored when a provider is already installed.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::limited(5))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(LiveTransport { client })
    }
}

impl Transport for LiveTransport {
    fn send(&self, req: OutRequest) -> BoxFuture<'_, Result<OutResponse, OutError>> {
        Box::pin(async move {
            let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| OutError::Network(e.to_string()))?;
            let mut rb = self.client.request(method, &req.url).timeout(req.timeout);
            for (k, v) in &req.headers {
                rb = rb.header(k.as_str(), v.as_str());
            }
            if let Some(b) = req.body {
                rb = rb.body(b);
            }
            let mut res = rb.send().await.map_err(map_error)?;
            let status = res.status().as_u16();
            let url = res.url().to_string();
            let content_type = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let mut body = Vec::new();
            let mut truncated = false;
            while let Some(chunk) = res.chunk().await.map_err(map_error)? {
                if body.len() + chunk.len() > req.max_bytes {
                    body.extend_from_slice(&chunk[..req.max_bytes - body.len()]);
                    truncated = true;
                    break;
                }
                body.extend_from_slice(&chunk);
            }
            Ok(OutResponse { status, url, content_type, body, truncated })
        })
    }
}

fn map_error(e: reqwest::Error) -> OutError {
    if e.is_timeout() {
        OutError::Timeout
    } else {
        // Without the URL: it can be long, and the message is shown to the reader.
        OutError::Network(e.without_url().to_string())
    }
}
