//! Forward Ports — VS Code-style "Ports" panel next to the agents.
//!
//! Two pieces:
//! - `ports_list`: TCP ports in LISTEN on the machine, with process, command
//!   line and `inWorkspace` flag (the process or one of its ancestors runs inside the
//!   session folder) → the webapp auto-forwards them like VS Code.
//! - `ports_forward` / `ports_stop`: local TCP proxy (tokio) from
//!   `bindHost:localPort` to `targetHost:targetPort`. Needed when the user
//!   changes the local port or makes the port public (bind 0.0.0.0); if port and
//!   host match the target the webapp calls nothing (no proxy).
//!
//! Local-only: nothing leaves the device. Label/protocol/visibility live in the webapp.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub port: u16,
    pub host: String,
    pub pid: u32,
    pub process: String,
    pub command: String,
    pub in_workspace: bool,
}

struct Tunnel {
    local_port: u16,
    bind_host: String,
    target_host: String,
    target_port: u16,
    connections: Arc<AtomicU64>,
    task: tokio::task::JoinHandle<()>,
    /// Flipped by `ports_stop`: open connections close too, not only the
    /// listener (a port made private again must not stay reachable).
    stop: tokio::sync::watch::Sender<bool>,
}

fn tunnels() -> &'static Mutex<HashMap<u16, Tunnel>> {
    static T: OnceLock<Mutex<HashMap<u16, Tunnel>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg_attr(unix, allow(dead_code))]
const DEV_PROCESSES: &[&str] = &[
    "node",
    "deno",
    "bun",
    "python",
    "python3",
    "ruby",
    "php",
    "java",
    "dotnet",
    "go",
    "cargo",
    "uvicorn",
    "gunicorn",
    "rails",
    "puma",
    "vite",
    "next-server",
    "esbuild",
    "hugo",
    "jekyll",
];

#[cfg_attr(unix, allow(dead_code))]
fn is_dev_process(name: &str) -> bool {
    let n = name.to_lowercase();
    let n = n.trim_end_matches(".exe");
    DEV_PROCESSES
        .iter()
        .any(|d| n == *d || n.starts_with(&format!("{d}.")))
}

fn split_host_port(addr: &str) -> Option<(String, u16)> {
    let idx = addr.rfind(':')?;
    let port = addr[idx + 1..].parse().ok()?;
    let host = addr[..idx]
        .trim_matches(|c| c == '[' || c == ']')
        .to_string();
    Some((if host.is_empty() { "*".into() } else { host }, port))
}

#[cfg_attr(not(unix), allow(dead_code))]
fn path_inside(child: &str, root: &str) -> bool {
    let root = root.trim_end_matches(['/', '\\']);
    !root.is_empty()
        && (child == root
            || child.starts_with(&format!("{root}/"))
            || child.starts_with(&format!("{root}\\")))
}

#[cfg(unix)]
fn scan(cwd: Option<&str>) -> Vec<ListeningPort> {
    use crate::commands::util_cmd::cmd;
    let out = match cmd("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return vec![],
    };
    // (pid, name, host, port)
    let mut rows: Vec<(u32, String, String, u16)> = vec![];
    let (mut pid, mut name) = (0u32, String::new());
    for line in out.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => pid = rest.parse().unwrap_or(0),
            "c" => name = rest.to_string(),
            "n" => {
                if let Some((h, p)) = split_host_port(rest) {
                    rows.push((pid, name.clone(), h, p));
                }
            }
            _ => {}
        }
    }

    // Process tree + command line (ps is everywhere on macOS/Linux).
    let mut ppid: HashMap<u32, u32> = HashMap::new();
    let mut args: HashMap<u32, String> = HashMap::new();
    if let Ok(o) = cmd("ps").args(["-A", "-o", "pid=,ppid=,args="]).output() {
        for l in String::from_utf8_lossy(&o.stdout).lines() {
            let mut it = l.split_whitespace();
            let (Some(a), Some(b)) = (it.next(), it.next()) else {
                continue;
            };
            let (Ok(a), Ok(b)) = (a.parse::<u32>(), b.parse::<u32>()) else {
                continue;
            };
            ppid.insert(a, b);
            args.insert(a, it.collect::<Vec<_>>().join(" "));
        }
    }

    // cwd of the listeners and their ancestors in a single lsof call.
    let mut cwds: HashMap<u32, String> = HashMap::new();
    if let Some(_root) = cwd.filter(|c| !c.is_empty()) {
        let mut want: HashSet<u32> = HashSet::new();
        for (p, ..) in &rows {
            let mut cur = *p;
            for _ in 0..32 {
                if cur <= 1 || !want.insert(cur) {
                    break;
                }
                cur = *ppid.get(&cur).unwrap_or(&0);
            }
        }
        if !want.is_empty() {
            let list = want
                .iter()
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
                .join(",");
            if let Ok(o) = cmd("lsof")
                .args(["-a", "-p", &list, "-d", "cwd", "-F", "pn"])
                .output()
            {
                let mut cur = 0u32;
                for l in String::from_utf8_lossy(&o.stdout).lines() {
                    if let Some(r) = l.strip_prefix('p') {
                        cur = r.parse().unwrap_or(0);
                    } else if let Some(r) = l.strip_prefix('n') {
                        cwds.insert(cur, r.to_string());
                    }
                }
            }
        }
    }

    let mut seen = HashSet::new();
    let mut res = vec![];
    for (p, n, h, port) in rows {
        if !seen.insert(port) {
            continue;
        }
        let in_ws = match cwd.filter(|c| !c.is_empty()) {
            Some(root) => {
                let mut cur = p;
                let mut hit = false;
                for _ in 0..32 {
                    if cur <= 1 {
                        break;
                    }
                    if cwds.get(&cur).is_some_and(|c| path_inside(c, root)) {
                        hit = true;
                        break;
                    }
                    cur = *ppid.get(&cur).unwrap_or(&0);
                }
                hit
            }
            None => false,
        };
        res.push(ListeningPort {
            port,
            host: h,
            pid: p,
            command: args.get(&p).cloned().unwrap_or_else(|| n.clone()),
            process: n,
            in_workspace: in_ws,
        });
    }
    res.sort_by_key(|r| r.port);
    res
}

#[cfg(windows)]
fn scan(_cwd: Option<&str>) -> Vec<ListeningPort> {
    use crate::commands::util_cmd::cmd;
    let mut names: HashMap<u32, String> = HashMap::new();
    if let Ok(o) = cmd("tasklist").args(["/FO", "CSV", "/NH"]).output() {
        for l in String::from_utf8_lossy(&o.stdout).lines() {
            let cols: Vec<&str> = l.split("\",\"").map(|c| c.trim_matches('"')).collect();
            if cols.len() > 1 {
                if let Ok(pid) = cols[1].parse() {
                    names.insert(pid, cols[0].to_string());
                }
            }
        }
    }
    let out = match cmd("netstat").args(["-ano", "-p", "TCP"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return vec![],
    };
    let mut seen = HashSet::new();
    let mut res = vec![];
    for l in out.lines() {
        let cols: Vec<&str> = l.split_whitespace().collect();
        // The state column is translated ("ABHÖREN", "ÉCOUTE"…): a listening
        // TCP socket is the one with no remote end (`0.0.0.0:0` / `[::]:0`).
        if cols.len() < 5 || !cols[0].eq_ignore_ascii_case("TCP") || !is_listening_remote(cols[2]) {
            continue;
        }
        let Some((h, port)) = split_host_port(cols[1]) else {
            continue;
        };
        if !seen.insert(port) {
            continue;
        }
        let pid: u32 = cols[4].parse().unwrap_or(0);
        let name = names.get(&pid).cloned().unwrap_or_default();
        // process cwd not readable without privileges: heuristic on the name.
        let in_ws = port >= 1024 && is_dev_process(&name);
        res.push(ListeningPort {
            port,
            host: h,
            pid,
            command: name.clone(),
            process: name,
            in_workspace: in_ws,
        });
    }
    res.sort_by_key(|r| r.port);
    res
}

/// `netstat -ano` foreign address of a listening socket.
#[cfg_attr(unix, allow(dead_code))]
fn is_listening_remote(foreign: &str) -> bool {
    matches!(foreign, "0.0.0.0:0" | "[::]:0" | "*:*")
}

/// ports:list — listening ports + active tunnels.
#[tauri::command]
pub async fn ports_list(cwd: Option<String>) -> Value {
    let listening = tokio::task::spawn_blocking(move || scan(cwd.as_deref()))
        .await
        .unwrap_or_default();
    let forwards: Vec<Value> = tunnels()
        .lock()
        .values()
        .map(|t| {
            json!({
                "localPort": t.local_port,
                "bindHost": t.bind_host,
                "targetHost": t.target_host,
                "targetPort": t.target_port,
                "connections": t.connections.load(Ordering::Relaxed),
            })
        })
        .collect();
    json!({ "ok": true, "listening": listening, "forwards": forwards })
}

async fn pipe(
    inbound: TcpStream,
    target: String,
    conns: Arc<AtomicU64>,
    mut stop: tokio::sync::watch::Receiver<bool>,
) {
    let Ok(outbound) = TcpStream::connect(&target).await else {
        return;
    };
    conns.fetch_add(1, Ordering::Relaxed);
    let (mut ri, mut wi) = inbound.into_split();
    let (mut ro, mut wo) = outbound.into_split();
    tokio::select! {
        _ = async {
            tokio::join!(
                tokio::io::copy(&mut ri, &mut wo),
                tokio::io::copy(&mut ro, &mut wi)
            )
        } => {}
        _ = stop.wait_for(|stopped| *stopped) => {}
    }
    conns.fetch_sub(1, Ordering::Relaxed);
}

/// ports:forward — opens a proxy `bindHost:localPort` → `targetHost:targetPort`.
/// `localPort` 0 or taken → next free port (like VS Code).
#[tauri::command]
pub async fn ports_forward(
    target_port: u16,
    target_host: Option<String>,
    local_port: Option<u16>,
    public: Option<bool>,
) -> Value {
    let target_host = target_host
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "127.0.0.1".into());
    let bind_host = if public.unwrap_or(false) {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    }
    .to_string();
    let wanted = local_port.unwrap_or(target_port);
    let mut listener = None;
    let mut last_err = String::new();
    let candidates: Vec<u16> = if wanted == 0 {
        vec![0]
    } else {
        (0..50u16).filter_map(|i| wanted.checked_add(i)).collect()
    };
    for p in candidates {
        if tunnels().lock().contains_key(&p) {
            continue;
        }
        match TcpListener::bind((bind_host.as_str(), p)).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let Some(listener) = listener else {
        return json!({ "ok": false, "error": if last_err.is_empty() { "no_free_port".into() } else { last_err } });
    };
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(wanted);
    let conns = Arc::new(AtomicU64::new(0));
    let target = format!("{target_host}:{target_port}");
    let (c2, t2) = (conns.clone(), target.clone());
    let (stop, stopped) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(async move {
        while let Ok((sock, _)) = listener.accept().await {
            tokio::spawn(pipe(sock, t2.clone(), c2.clone(), stopped.clone()));
        }
    });
    tunnels().lock().insert(
        bound,
        Tunnel {
            local_port: bound,
            bind_host: bind_host.clone(),
            target_host,
            target_port,
            connections: conns,
            task,
            stop,
        },
    );
    json!({ "ok": true, "localPort": bound, "bindHost": bind_host })
}

/// ports:stop — closes the proxy on the given local port.
#[tauri::command]
pub fn ports_stop(local_port: u16) -> Value {
    match tunnels().lock().remove(&local_port) {
        Some(t) => {
            t.task.abort();
            let _ = t.stop.send(true);
            json!({ "ok": true })
        }
        None => json!({ "ok": false, "error": "not_found" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lsof_addresses() {
        assert_eq!(split_host_port("*:3000"), Some(("*".into(), 3000)));
        assert_eq!(
            split_host_port("127.0.0.1:5173"),
            Some(("127.0.0.1".into(), 5173))
        );
        assert_eq!(split_host_port("[::1]:8080"), Some(("::1".into(), 8080)));
    }

    #[test]
    fn workspace_containment() {
        assert!(path_inside("/a/b/c", "/a/b"));
        assert!(path_inside("/a/b", "/a/b/"));
        assert!(!path_inside("/a/bc", "/a/b"));
    }

    #[test]
    fn listening_rows_do_not_depend_on_the_windows_language() {
        assert!(is_listening_remote("0.0.0.0:0"));
        assert!(is_listening_remote("[::]:0"));
        assert!(!is_listening_remote("127.0.0.1:50123"));
    }

    #[tokio::test]
    async fn stop_closes_open_connections_too() {
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = upstream.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = upstream.accept().await {
                tokio::spawn(async move {
                    let (mut r, mut w) = s.split();
                    let _ = tokio::io::copy(&mut r, &mut w).await;
                });
            }
        });
        let res = ports_forward(target, None, Some(0), None).await;
        let local = res["localPort"].as_u64().unwrap() as u16;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut c = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
        c.write_all(b"ping").await.unwrap();
        let mut buf = [0u8; 4];
        c.read_exact(&mut buf).await.unwrap();
        assert_eq!(ports_stop(local)["ok"], true);
        // The live connection is closed by the stop: the read ends (EOF/error).
        let mut rest = [0u8; 1];
        let ended = tokio::time::timeout(std::time::Duration::from_secs(3), c.read(&mut rest))
            .await
            .expect("connection still open after stop");
        assert!(matches!(ended, Ok(0) | Err(_)));
    }

    #[tokio::test]
    async fn forwards_and_stops() {
        let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = echo.accept().await.unwrap();
            let (mut r, mut w) = s.split();
            let _ = tokio::io::copy(&mut r, &mut w).await;
        });
        let res = ports_forward(target, None, Some(0), None).await;
        let local = res["localPort"].as_u64().unwrap() as u16;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut c = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
        c.write_all(b"ping").await.unwrap();
        let mut buf = [0u8; 4];
        c.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"ping");
        assert_eq!(ports_stop(local)["ok"], true);
    }
}
