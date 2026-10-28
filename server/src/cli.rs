//! `pager [file] [--no-open] [--port N] [--status] [--stop]`
//!
//! Starts the reading service in the background if it isn't running, adds the file, and opens it in
//! the browser. With no file, opens the library.

use crate::config::{default_data_dir, default_port, WEB_DEV_PORT};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub struct CliArgs {
    pub file: Option<String>,
    pub open: bool,
    pub port: Option<u16>,
    pub status: bool,
    pub stop: bool,
    pub help: bool,
}

pub fn parse_args(argv: &[String]) -> CliArgs {
    let mut a = CliArgs { file: None, open: true, port: None, status: false, stop: false, help: false };
    let mut i = 0;
    while i < argv.len() {
        let v = argv[i].as_str();
        match v {
            "--no-open" => a.open = false,
            "--status" => a.status = true,
            "--stop" => a.stop = true,
            "-h" | "--help" => a.help = true,
            "--port" => {
                i += 1;
                a.port = argv.get(i).and_then(|p| p.parse().ok());
            }
            _ if v.starts_with("--port=") => a.port = v[7..].parse().ok(),
            _ => {
                if a.file.is_none() {
                    a.file = Some(v.to_string());
                }
            }
        }
        i += 1;
    }
    a
}

pub const HELP: &str = "Usage: pager [file] [options]

Open a book or document in Pager.

  pager ~/Books/persuasion.epub   add the file (if new) and open it
  pager                           open the library

Options:
  --no-open    add the file but don't open a browser
  --port N     use another port (default 3006, or PAGER_PORT)
  --status     say whether the reading service is running
  --stop       stop the background reading service
";

/// An HTTP answer: status and the body (JSON when it parses).
pub struct Answer {
    pub status: u16,
    pub body: Value,
    pub text: String,
}

/// What the command needs from the outside world, so tests can stand it in.
pub trait Deps {
    fn fetch(&mut self, method: &str, port: u16, path: &str, body: Option<&Value>, timeout: Duration) -> Option<Answer>;
    fn spawn_server(&mut self, port: u16, data_dir: &Path);
    fn open_url(&mut self, url: &str);
    fn log(&mut self, s: &str);
    fn error(&mut self, s: &str);
    fn sleep(&mut self, ms: u64);
    fn cwd(&self) -> PathBuf;
    fn data_dir(&self) -> PathBuf;
    fn port(&self) -> u16;
}

enum Health {
    Pager(Value),
    Other,
    Down,
}

fn health(deps: &mut dyn Deps, port: u16) -> Health {
    match deps.fetch("GET", port, "/api/health", None, Duration::from_millis(1500)) {
        None => Health::Down,
        Some(a) if a.status != 200 => Health::Other,
        Some(a) => {
            if a.body.get("app").and_then(Value::as_str) == Some("pager") {
                Health::Pager(a.body)
            } else {
                Health::Other
            }
        }
    }
}

fn web_origin(deps: &mut dyn Deps, port: u16) -> String {
    // Prefer the Vite dev server when it's running (npm run dev:api), else the server's own origin.
    if let Some(a) = deps.fetch("GET", WEB_DEV_PORT, "/", None, Duration::from_millis(800)) {
        if a.status == 200 {
            return format!("http://localhost:{WEB_DEV_PORT}");
        }
    }
    format!("http://localhost:{port}")
}

pub fn run_cli(argv: &[String], deps: &mut dyn Deps) -> i32 {
    let args = parse_args(argv);
    if args.help {
        deps.log(HELP);
        return 0;
    }
    let port = args.port.unwrap_or_else(|| deps.port());
    let data_dir = deps.data_dir();
    let h = health(deps, port);
    if let Health::Other = h {
        deps.error(&format!("Something else is using port {port}. Start Pager on another port with --port."));
        return 1;
    }
    if args.status {
        match h {
            Health::Pager(v) => deps.log(&format!("Pager {} is running at http://localhost:{port} (data: {}).", v.get("version").and_then(Value::as_str).unwrap_or(""), v.get("dataDir").and_then(Value::as_str).unwrap_or(""))),
            _ => deps.log("Pager isn't running."),
        }
        return 0;
    }
    if args.stop {
        if let Health::Down = h {
            deps.log("Pager isn't running.");
            return 0;
        }
        let _ = deps.fetch("POST", port, "/api/shutdown", None, Duration::from_millis(1500));
        deps.log("Stopped Pager.");
        return 0;
    }
    if let Health::Down = h {
        deps.spawn_server(port, &data_dir);
        let mut up = false;
        for _ in 0..40 {
            deps.sleep(200);
            match health(deps, port) {
                Health::Pager(_) => {
                    up = true;
                    break;
                }
                Health::Other => break,
                Health::Down => {}
            }
        }
        if !up {
            deps.error(&format!("Pager didn't start. See {}.", data_dir.join("logs").join("server.log").display()));
            return 1;
        }
    }
    let mut target = "/".to_string();
    if let Some(file) = &args.file {
        // "~/…" is expanded by the server; anything else is relative to where the command ran.
        let abs = if file.starts_with('~') { file.clone() } else { deps.cwd().join(file).to_string_lossy().into_owned() };
        let Some(res) = deps.fetch("POST", port, "/api/files/import", Some(&json!({ "dir": "", "path": abs })), Duration::from_secs(30)) else {
            deps.error(&format!("Pager couldn't open {file}."));
            return 1;
        };
        let envelope = res.body.get("error").filter(|e| e.is_object()).cloned();
        if res.status >= 400 || envelope.is_some() {
            deps.error(envelope.as_ref().and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or(&format!("Pager couldn't open {file}.")));
            return 1;
        }
        let mut body = res.body;
        // A folder is copied in the background; wait for the job so the library shows everything.
        for _ in 0..300 {
            let status = body.get("status").and_then(Value::as_str).unwrap_or("");
            if status == "done" || status == "error" {
                break;
            }
            deps.sleep(200);
            let id = body.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            if let Some(again) = deps.fetch("GET", port, &format!("/api/jobs/{id}"), None, Duration::from_secs(5)) {
                if again.body.is_object() {
                    body = again.body;
                }
            }
        }
        if body.get("status").and_then(Value::as_str) == Some("error") {
            deps.error(body.get("error").and_then(Value::as_str).unwrap_or(&format!("Pager couldn't open {file}.")));
            return 1;
        }
        let ids: Vec<&str> = body.get("documentIds").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let Some(doc_id) = ids.first() else {
            deps.error(&format!("Pager couldn't find anything to read in {file}."));
            return 1;
        };
        if ids.len() == 1 {
            target = format!("/read/{doc_id}");
        }
        deps.log(&format!("Added {}.", Path::new(&abs).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    }
    let url = format!("{}{target}", web_origin(deps, port));
    if args.open {
        deps.open_url(&url);
    }
    deps.log(&url);
    0
}

/// A small HTTP/1.1 client for loopback calls (no dependencies).
pub fn http(method: &str, port: u16, path: &str, body: Option<&Value>, timeout: Duration) -> Option<Answer> {
    let mut stream = TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().ok()?, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    let payload = body.map(|b| serde_json::to_vec(b).unwrap_or_default()).unwrap_or_default();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\nAccept: application/json\r\n");
    if body.is_some() {
        req.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", payload.len()));
    } else if method != "GET" {
        req.push_str("Content-Length: 0\r\n");
    }
    req.push_str("\r\n");
    stream.write_all(req.as_bytes()).ok()?;
    stream.write_all(&payload).ok()?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).ok()?;
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, rest) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status: u16 = head.split_whitespace().nth(1).and_then(|s| s.parse().ok())?;
    let chunked = head.to_lowercase().contains("transfer-encoding: chunked");
    let body_text = if chunked { dechunk(rest) } else { rest.to_string() };
    let body = serde_json::from_str(&body_text).unwrap_or(Value::Null);
    Some(Answer { status, body, text: body_text })
}

fn dechunk(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    loop {
        let Some((size_line, after)) = rest.split_once("\r\n") else { break };
        let size = usize::from_str_radix(size_line.trim().split(';').next().unwrap_or("0"), 16).unwrap_or(0);
        if size == 0 {
            break;
        }
        let chunk: String = after.chars().take(size).collect();
        out.push_str(&chunk);
        rest = &after[chunk.len().min(after.len())..];
        rest = rest.strip_prefix("\r\n").unwrap_or(rest);
    }
    out
}

/// The real world: the loopback HTTP client, a detached server process and the system browser.
pub struct SystemDeps;

impl Deps for SystemDeps {
    fn fetch(&mut self, method: &str, port: u16, path: &str, body: Option<&Value>, timeout: Duration) -> Option<Answer> {
        http(method, port, path, body, timeout)
    }

    fn spawn_server(&mut self, port: u16, data_dir: &Path) {
        let logs = data_dir.join("logs");
        let _ = std::fs::create_dir_all(&logs);
        let log = std::fs::OpenOptions::new().append(true).create(true).open(logs.join("server.log")).ok();
        let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("pager-server"))).filter(|p| p.exists()).unwrap_or_else(|| PathBuf::from("pager-server"));
        let mut cmd = std::process::Command::new(exe);
        cmd.env("PAGER_PORT", port.to_string()).env("PAGER_DATA_DIR", data_dir).env("PAGER_BACKGROUND", "1").stdin(std::process::Stdio::null());
        match log {
            Some(f) => {
                let err = f.try_clone().ok();
                cmd.stdout(std::process::Stdio::from(f));
                if let Some(e) = err {
                    cmd.stderr(std::process::Stdio::from(e));
                }
            }
            None => {
                cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let _ = cmd.spawn();
    }

    fn open_url(&mut self, url: &str) {
        let browser = std::env::var("BROWSER").ok().filter(|b| !b.is_empty());
        let (cmd, args): (String, Vec<String>) = match browser {
            Some(b) => (b, vec![url.to_string()]),
            None if cfg!(target_os = "macos") => ("open".into(), vec![url.to_string()]),
            None if cfg!(windows) => ("cmd".into(), vec!["/c".into(), "start".into(), String::new(), url.to_string()]),
            None => ("xdg-open".into(), vec![url.to_string()]),
        };
        let mut c = std::process::Command::new(cmd);
        c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            c.process_group(0);
        }
        if c.spawn().is_err() {
            println!("Open {url} in your browser.");
        }
    }

    fn log(&mut self, s: &str) {
        println!("{s}");
    }

    fn error(&mut self, s: &str) {
        eprintln!("{s}");
    }

    fn sleep(&mut self, ms: u64) {
        std::thread::sleep(Duration::from_millis(ms));
    }

    fn cwd(&self) -> PathBuf {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }

    fn data_dir(&self) -> PathBuf {
        default_data_dir()
    }

    fn port(&self) -> u16 {
        default_port()
    }
}
