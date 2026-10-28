//! SQLite: open, migrate (one transaction per migration, with a backup before an upgrade).

pub mod migrations;

use crate::errors::AppError;
use crate::Result;
use migrations::MIGRATIONS;
use rusqlite::Connection;
use std::path::Path;

/// The file was written by a newer Pager than this build knows.
pub fn newer_database(current: i64) -> AppError {
    AppError::new(
        500,
        "internal",
        format!("This library was written by a newer version of Pager (schema {current}; this build knows {}). Update Pager to open it.", MIGRATIONS.len()),
    )
}

pub fn user_version(db: &Connection) -> Result<i64> {
    Ok(db.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Apply pending migrations, one transaction each. Backs the file up first when upgrading.
pub fn migrate(db: &Connection, backup_dir: Option<&Path>) -> Result<()> {
    let current = user_version(db)?;
    if current > MIGRATIONS.len() as i64 {
        return Err(newer_database(current));
    }
    if current > 0 && current < MIGRATIONS.len() as i64 {
        if let Some(dir) = backup_dir {
            std::fs::create_dir_all(dir)?;
            let stamp = crate::clock::file_stamp(crate::clock::Clock::System.now_ms());
            let target = dir.join(format!("pager-v{current}-{stamp}.db"));
            db.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()])?;
        }
    }
    for v in (current as usize)..MIGRATIONS.len() {
        db.execute_batch("BEGIN")?;
        let r = db.execute_batch(MIGRATIONS[v]).and_then(|_| db.execute_batch(&format!("PRAGMA user_version = {}", v + 1)));
        match r {
            Ok(()) => db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = db.execute_batch("ROLLBACK");
                return Err(e.into());
            }
        }
    }
    Ok(())
}

pub fn open_db(file: &Path, backup_dir: Option<&Path>) -> Result<Connection> {
    let memory = file.to_string_lossy() == ":memory:";
    if !memory {
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let db = if memory { Connection::open_in_memory()? } else { Connection::open(file)? };
    if !memory {
        db.pragma_update(None, "journal_mode", "WAL")?;
    }
    db.pragma_update(None, "foreign_keys", "ON")?;
    db.busy_timeout(std::time::Duration::from_millis(5000))?;
    migrate(&db, backup_dir)?;
    Ok(db)
}

/// JSON column helpers.
pub fn to_json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".to_string())
}

pub fn from_json<T: serde::de::DeserializeOwned>(s: Option<&str>, fallback: T) -> T {
    match s {
        Some(s) => serde_json::from_str(s).unwrap_or(fallback),
        None => fallback,
    }
}
