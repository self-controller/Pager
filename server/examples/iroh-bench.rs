//! The Phase 0 gate (prompts/iroh-migration.md): is iroh, in this process, fast enough to carry
//! books? Both ends run here on loopback with relays off, so this measures iroh and QUIC, not the
//! network. CPU is this process's, so both ends together.
//!
//!   cargo run --release --example iroh-bench [-- --mb 200]
//!
//! Gate: at least 100 MB/s, at most 10 CPU-seconds per GB, and a 2 KB request's median round trip
//! of 1.5 ms or less. Exit 1 when it fails.

use pager_server::remote::node::{bind_endpoint, loopback_addr, IrohOptions};
use std::time::Instant;

const MB: usize = 1024 * 1024;
const CHUNK: usize = 64 * 1024;
const ALPN: &[u8] = b"pager/bench/1";

/// Time this process has spent on a CPU, in seconds (Linux).
fn cpu_seconds() -> Option<f64> {
    let s = std::fs::read_to_string("/proc/self/schedstat").ok()?;
    s.split_whitespace().next()?.parse::<f64>().ok().map(|ns| ns / 1e9)
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

#[tokio::main]
async fn main() {
    let mut mb = 50usize;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--mb" && i + 1 < args.len() {
            mb = args[i + 1].parse().expect("--mb <megabytes>");
            i += 2;
        } else {
            eprintln!("Unknown argument {}", args[i]);
            std::process::exit(2);
        }
    }
    let size = mb * MB;

    let mut o = IrohOptions::loopback();
    o.alpns = vec![ALPN.to_vec()];
    let server = bind_endpoint(o).await.expect("bind the server");
    let mut o = IrohOptions::loopback();
    o.alpns = vec![];
    let client = bind_endpoint(o).await.expect("bind the client");

    // Server: each bi stream is one request, and its first four bytes say how many bytes to send back.
    let payload = bytes::Bytes::from(vec![7u8; size]);
    let s = server.clone();
    let p = payload.clone();
    tokio::spawn(async move {
        while let Some(incoming) = s.accept().await {
            let Ok(accepting) = incoming.accept() else { continue };
            let p = p.clone();
            tokio::spawn(async move {
                let Ok(conn) = accepting.await else { return };
                loop {
                    let Ok((mut send, mut recv)) = conn.accept_bi().await else { return };
                    let p = p.clone();
                    tokio::spawn(async move {
                        let req = recv.read_to_end(1 << 20).await.unwrap();
                        let n = u32::from_be_bytes(req[..4].try_into().unwrap()) as usize;
                        let mut off = 0;
                        while off < n {
                            let end = (off + CHUNK).min(n);
                            send.write_chunk(p.slice(off..end)).await.unwrap();
                            off = end;
                        }
                        send.finish().unwrap();
                    });
                }
            });
        }
    });

    let t = Instant::now();
    let conn = client.connect(loopback_addr(&server), ALPN).await.expect("connect over loopback");
    let handshake_ms = t.elapsed().as_secs_f64() * 1e3;

    // Client: ask for n bytes and read them in 64 KB reads, as the bridge does.
    let request = |n: usize| {
        let conn = conn.clone();
        async move {
            let (mut send, mut recv) = conn.open_bi().await.unwrap();
            let mut head = [0u8; 200];
            head[..4].copy_from_slice(&(n as u32).to_be_bytes());
            send.write_all(&head).await.unwrap();
            send.finish().unwrap();
            let mut got = 0;
            let mut buf = vec![0u8; CHUNK];
            while let Some(k) = recv.read(&mut buf).await.unwrap() {
                got += k;
            }
            got
        }
    };
    let latency = |n: usize, reps: usize| async move {
        for _ in 0..20 {
            request(n).await;
        }
        let mut times = Vec::with_capacity(reps);
        for _ in 0..reps {
            let s = Instant::now();
            request(n).await;
            times.push(s.elapsed().as_secs_f64() * 1e3);
        }
        median(times)
    };
    let ms_2kb = latency(2048, 300).await;
    let ms_200kb = latency(200 * 1024, 100).await;

    let cpu0 = cpu_seconds();
    let s = Instant::now();
    let got = request(size).await;
    let secs = s.elapsed().as_secs_f64();
    let cpu = match (cpu0, cpu_seconds()) {
        (Some(a), Some(b)) => Some(b - a),
        _ => None,
    };
    assert_eq!(got, size, "got {got} of {size} bytes");
    let mbps = size as f64 / MB as f64 / secs;
    let cpu_per_gb = cpu.map(|c| c / (size as f64 / (1024.0 * MB as f64)));

    println!("iroh in one process, loopback, relays off");
    println!("  handshake                 {handshake_ms:.1} ms");
    println!("  2 KB request, median      {ms_2kb:.3} ms");
    println!("  200 KB request, median    {ms_200kb:.2} ms");
    println!("  bulk {mb} MB               {mbps:.0} MB/s");
    match cpu_per_gb {
        Some(c) => println!("  bulk CPU (both ends)      {c:.1} s per GB"),
        None => println!("  bulk CPU (both ends)      n/a (not Linux)"),
    }
    let checks = [("bulk ≥ 100 MB/s", mbps >= 100.0), ("bulk ≤ 10 CPU-s/GB", cpu_per_gb.map(|c| c <= 10.0).unwrap_or(true)), ("2 KB median ≤ 1.5 ms", ms_2kb <= 1.5)];
    println!("\nGate:");
    for (what, ok) in checks {
        println!("  {}  {what}", if ok { "pass" } else { "FAIL" });
    }
    let pass = checks.iter().all(|(_, ok)| *ok);
    println!("{}", if pass { "\nPASS: Phase 0's gate is met." } else { "\nFAIL: see prompts/iroh-migration.md." });
    client.close().await;
    server.close().await;
    std::process::exit(if pass { 0 } else { 1 });
}
