//! The live stream: replays from Last-Event-ID, then follows the journal. A device's stream ends the
//! moment it is revoked, or when the remote listener stops.

use super::DeviceCtx;
use crate::app::App;
use crate::core::Notice;
use crate::model::JournalEvent;
use axum::extract::{Extension, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use futures::stream::Stream;
use std::convert::Infallible;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

struct Guard {
    app: Arc<App>,
    sub: u64,
}

impl Drop for Guard {
    fn drop(&mut self) {
        self.app.bus.unsubscribe(self.sub);
        self.app.idle.streams.fetch_sub(1, Ordering::SeqCst);
        self.app.touch();
        self.app.notify(Notice::StreamClose);
    }
}

fn to_event(e: &JournalEvent) -> Event {
    Event::default().id(e.seq.to_string()).event(e.kind.clone()).data(serde_json::to_string(e).unwrap_or_default())
}

pub async fn stream(State(app): State<Arc<App>>, headers: HeaderMap, RawQuery(raw): RawQuery, device: Option<Extension<DeviceCtx>>) -> Response {
    let q = super::query(&raw);
    let from = headers.get("last-event-id").and_then(|v| v.to_str().ok()).map(str::to_string).or_else(|| q.get("after").cloned());
    let after: Option<i64> = from.filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())).and_then(|s| s.parse().ok());
    let device_id = device.map(|d| d.0 .0.id);
    let (sub, mut rx) = app.bus.subscribe();
    let mut notices = app.notices.subscribe();
    app.idle.streams.fetch_add(1, Ordering::SeqCst);
    app.notify(Notice::StreamOpen);
    let guard = Guard { app: app.clone(), sub };
    let is_device = device_id.is_some();
    let s: std::pin::Pin<Box<dyn Stream<Item = std::result::Result<Event, Infallible>> + Send>> = Box::pin(async_stream::stream! {
        let _guard = guard;
        let mut last_sent: i64;
        match after {
            Some(a) => {
                last_sent = a;
                loop {
                    let from = last_sent;
                    let batch = app.run(move |c| c.events_since(from, 1000)).await.unwrap_or_default();
                    if batch.is_empty() {
                        break;
                    }
                    for e in batch {
                        if !(is_device && e.kind.starts_with("source.")) {
                            yield Ok(to_event(&e));
                        }
                        last_sent = e.seq;
                    }
                }
            }
            None => {
                yield Ok(Event::default().comment("connected"));
                last_sent = 0;
            }
        }
        loop {
            tokio::select! {
                ev = rx.recv() => match ev {
                    Some(e) => {
                        if e.seq <= last_sent { continue; }
                        last_sent = e.seq;
                        if is_device && e.kind.starts_with("source.") { continue; }
                        yield Ok(to_event(&e));
                    }
                    None => break,
                },
                n = notices.recv() => match n {
                    Ok(Notice::DeviceRevoked(id)) if Some(&id) == device_id.as_ref() => break,
                    Ok(Notice::RemoteClosing) if is_device => break,
                    Ok(Notice::Closing) | Ok(Notice::Shutdown) => break,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    _ => {}
                },
                _ = tokio::time::sleep(Duration::from_secs(20)) => {
                    yield Ok(Event::default().comment("heartbeat"));
                }
            }
        }
    });
    Sse::new(s).into_response()
}
