//! Phones over iroh. The computer binds an iroh endpoint while remote access is on; a phone dials
//! the computer's endpoint ID (an Ed25519 public key) and connects directly when it can, through a
//! relay when it can't. Each bidirectional QUIC stream carries one `pager/1` request, which the
//! bridge hands to the remote app in this process: no socket listens for phones on this path, and
//! the peer's identity reaches the app as a request extension, never as a header.

pub mod bridge;
pub mod client;
pub mod identity;
pub mod node;
pub mod protocol;
