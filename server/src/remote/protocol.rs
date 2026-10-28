//! `pager/1`: one request per bidirectional QUIC stream, HTTP-shaped, with no HTTP parser on
//! either end. The client writes a u32 big-endian length, a JSON head `{ v, method, path, headers }`
//! of at most 16 KB, then the body, then finishes its side. The server answers with a u32 length, a
//! JSON head `{ status, headers }`, then the body, then finishes. A head that is too large, malformed
//! or of an unknown version resets the stream with one of the codes in `reset`. A client that stops
//! reading ends the request on the server, which is how a live stream is hung up.

use iroh::endpoint::{ReadError, ReadExactError, RecvStream, SendStream, VarInt, WriteError};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const ALPN: &[u8] = b"pager/1";
pub const VERSION: u32 = 1;
pub const MAX_HEAD_BYTES: usize = 16 * 1024;
const LEN_BYTES: usize = 4;

/// Stream reset codes (QUIC application error codes).
pub mod reset {
    /// Not JSON, missing fields, a method or path that isn't one, or a header that isn't one.
    pub const BAD_HEAD: u32 = 1;
    /// The length prefix says more than 16 KB.
    pub const HEAD_TOO_LARGE: u32 = 2;
    /// `v` isn't 1.
    pub const BAD_VERSION: u32 = 3;
    /// The server failed while answering.
    pub const INTERNAL: u32 = 4;
}

/// Connection close codes. The reason bytes say the same in ASCII.
pub mod close {
    /// The endpoint is not a paired, active device and no pairing window is open.
    pub const NOT_PAIRED: u32 = 16;
    /// The device was revoked on the computer.
    pub const REVOKED: u32 = 17;
    /// Remote access was turned off.
    pub const REMOTE_OFF: u32 = 18;
    /// This phone opened more connections than the bridge keeps; the oldest is closed.
    pub const TOO_MANY_CONNECTIONS: u32 = 19;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RequestHead {
    pub v: u32,
    pub method: String,
    /// The path and query, inside the remote app: `/api/documents?limit=5`.
    pub path: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResponseHead {
    pub status: u16,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug)]
pub enum HeadError {
    /// The peer reset the stream with this code.
    Reset(u32),
    /// The stream or connection ended before a whole head arrived.
    Gone(String),
    TooLarge(usize),
    Malformed(String),
}

impl HeadError {
    /// What to reset the stream with when this head was ours to refuse.
    pub fn reset_code(&self) -> u32 {
        match self {
            HeadError::TooLarge(_) => reset::HEAD_TOO_LARGE,
            _ => reset::BAD_HEAD,
        }
    }
}

impl std::fmt::Display for HeadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HeadError::Reset(c) => write!(f, "the stream was reset with code {c}"),
            HeadError::Gone(m) => write!(f, "the stream ended early: {m}"),
            HeadError::TooLarge(n) => write!(f, "a head of {n} bytes is over the {MAX_HEAD_BYTES}-byte limit"),
            HeadError::Malformed(m) => write!(f, "the head isn't valid: {m}"),
        }
    }
}

fn gone(e: ReadExactError) -> HeadError {
    match e {
        ReadExactError::ReadError(ReadError::Reset(code)) => HeadError::Reset(code.into_inner() as u32),
        other => HeadError::Gone(other.to_string()),
    }
}

/// Read one framed head.
pub async fn read_head<T: DeserializeOwned>(recv: &mut RecvStream) -> Result<T, HeadError> {
    let mut len = [0u8; LEN_BYTES];
    recv.read_exact(&mut len).await.map_err(gone)?;
    let n = u32::from_be_bytes(len) as usize;
    if n > MAX_HEAD_BYTES {
        return Err(HeadError::TooLarge(n));
    }
    let mut buf = vec![0u8; n];
    recv.read_exact(&mut buf).await.map_err(gone)?;
    serde_json::from_slice(&buf).map_err(|e| HeadError::Malformed(e.to_string()))
}

/// The bytes of one framed head.
pub fn frame<T: Serialize>(head: &T) -> Vec<u8> {
    let json = serde_json::to_vec(head).expect("a head serialises");
    let mut out = Vec::with_capacity(LEN_BYTES + json.len());
    out.extend_from_slice(&(json.len() as u32).to_be_bytes());
    out.extend_from_slice(&json);
    out
}

pub async fn write_head<T: Serialize>(send: &mut SendStream, head: &T) -> Result<(), WriteError> {
    send.write_all(&frame(head)).await
}

pub fn code(n: u32) -> VarInt {
    VarInt::from_u32(n)
}
