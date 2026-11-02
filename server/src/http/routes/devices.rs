//! Paired devices and the pairing window, for the desktop. Mounted on the local listener only: none
//! of this exists on the remote one.

use crate::app::App;
use crate::errors::invalid;
use crate::http::{created, json_object, no_content, ok};
use crate::Result;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use std::sync::Arc;
use std::time::Duration;

pub fn router() -> Router<Arc<App>> {
    Router::new()
        .route("/devices/pairing", post(open_pairing).get(pairing_state).delete(cancel_pairing))
        .route("/devices/pairing/approve", post(approve))
        .route("/devices/pairing/deny", post(deny))
        .route("/devices", get(list))
        .route("/devices/{id}", patch(rename).delete(revoke))
}

/// How long a new window waits for iroh to reach its relay, so the link carries it.
const RELAY_WAIT: Duration = Duration::from_secs(3);

async fn open_pairing(State(app): State<Arc<App>>) -> Result<Response> {
    if !app.run(|c| Ok(c.app_settings().remote.enabled)).await? {
        return Err(invalid("Turn on remote access before pairing a phone."));
    }
    let ticket = app.iroh.ticket_with_relay(RELAY_WAIT).await;
    // The token iroh is running with, so the link matches the relay the ticket names.
    let relay_token = ticket.as_ref().and_then(|_| app.iroh.relay_token());
    let w = app
        .run(move |c| {
            let remote = c.app_settings().remote;
            if !remote.enabled {
                return Err(invalid("Turn on remote access before pairing a phone."));
            }
            if remote.origin.is_none() && ticket.is_none() {
                return Err(invalid("Remote access is on, but iroh didn't start (see the server's log), and no Tailscale address is set."));
            }
            c.pairing_open(remote.origin.as_deref(), ticket, relay_token.as_deref())
        })
        .await?;
    Ok(created(w))
}

async fn pairing_state(State(app): State<Arc<App>>) -> Result<Response> {
    Ok(ok(app.run(|c| Ok(c.pairing.state())).await?))
}

async fn approve(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(created(app.run(move |c| c.pairing_approve(b.get("requestId"))).await?))
}

async fn deny(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    app.run(move |c| c.pairing.deny(b.get("requestId"))).await?;
    Ok(no_content())
}

async fn cancel_pairing(State(app): State<Arc<App>>) -> Result<Response> {
    app.run(|c| {
        c.pairing.cancel();
        Ok(())
    })
    .await?;
    Ok(no_content())
}

async fn list(State(app): State<Arc<App>>) -> Result<Response> {
    Ok(ok(app.run(|c| c.device_list()).await?))
}

async fn rename(State(app): State<Arc<App>>, Path(id): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run(move |c| c.device_rename(&id, b.get("name"))).await?))
}

// Revokes an active device; removes one that is already revoked or expired.
async fn revoke(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    app.run(move |c| c.device_revoke(&id)).await?;
    Ok(no_content())
}
