use crate::app::App;
use crate::errors::invalid;
use crate::http::{ok, query, Api};
use crate::Result;
use axum::extract::{RawQuery, State};
use axum::response::Response;
use axum::routing::get;
use std::sync::Arc;

pub fn mount(api: Api) -> Api {
    api.add("GET", "/sync/manifest", get(manifest))
}

async fn manifest(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let after = match q.get("after") {
        None => None,
        Some(a) if !a.is_empty() && a.bytes().all(|b| b.is_ascii_digit()) => Some(a.parse::<i64>().map_err(|_| invalid("after is the cursor from the last manifest, a whole number."))?),
        Some(_) => return Err(invalid("after is the cursor from the last manifest, a whole number.")),
    };
    Ok(ok(app.run(move |c| c.sync_manifest(after)).await?))
}
