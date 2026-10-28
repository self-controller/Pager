//! Pager's backend in Rust: the same API (API.md, CONTRACT.md), the same SQLite schema and the
//! same block model as the TypeScript server it replaces. Module names follow the original layout.

pub mod anchoring;
pub mod annotations;
pub mod app;
pub mod cli;
pub mod clock;
pub mod config;
pub mod core;
pub mod db;
pub mod devices;
pub mod errors;
pub mod export;
pub mod http;
pub mod ids;
pub mod ingest;
pub mod journal;
pub mod library;
pub mod mirror;
pub mod model;
pub mod records;
pub mod remote;
pub mod render;
pub mod search;
pub mod server;
pub mod sessions;
pub mod settings;
pub mod util;

pub use errors::{AppError, Result};
