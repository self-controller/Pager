//! This computer's iroh identity: a 32-byte secret key at `<data>/remote/endpoint.key` (mode 0600),
//! made the first time remote access is turned on. Its public half is the endpoint ID phones dial.
//! Deleting the file gives the computer a new ID, and every phone has to pair again.

use crate::errors::AppError;
use crate::Result;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn key_file(data_dir: &Path) -> PathBuf {
    data_dir.join("remote").join("endpoint.key")
}

/// The key on disk, or a new one written there.
pub fn load_or_create(data_dir: &Path) -> Result<iroh::SecretKey> {
    let file = key_file(data_dir);
    match std::fs::read(&file) {
        Ok(bytes) => {
            let raw: [u8; 32] = bytes.as_slice().try_into().map_err(|_| AppError::internal(format!("{} should hold a 32-byte key; move it aside to give this computer a new ID", file.display())))?;
            Ok(iroh::SecretKey::from_bytes(&raw))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let key = iroh::SecretKey::generate();
            write_private(&file, &key.to_bytes())?;
            Ok(key)
        }
        Err(e) => Err(e.into()),
    }
}

/// Write the key readable by this user only, through a temporary file, so a crash leaves no half key.
fn write_private(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("key.tmp");
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_same_key_and_refuses_a_damaged_one() {
        let dir = std::env::temp_dir().join(format!("pager-identity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = load_or_create(&dir).unwrap();
        let b = load_or_create(&dir).unwrap();
        assert_eq!(a.public(), b.public());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(key_file(&dir)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::write(key_file(&dir), b"short").unwrap();
        assert!(load_or_create(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
