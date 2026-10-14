use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU16, Ordering};
use std::thread;

static EMBED_PORT: AtomicU16 = AtomicU16::new(0);

/// Returns the port the local YouTube embed server is listening on.
pub fn get_embed_port() -> u16 {
    EMBED_PORT.load(Ordering::SeqCst)
}

/// Starts a lightweight loopback HTTP server on 127.0.0.1 to serve YouTube embed iframes.
///
/// On macOS and Linux, Tauri desktop webviews run under custom protocol origins (`tauri://localhost`),
/// which omit valid HTTP Referer headers when calling cross-origin HTTPS endpoints.
/// As documented in Tauri issue #14422, YouTube's player API rejects missing/non-HTTP referers
/// with Error 153 ("Video player configuration error").
///
/// By hosting the embed wrapper on a local loopback HTTP origin (`http://127.0.0.1:<port>`),
/// WebKit passes a valid HTTP Referer to YouTube, satisfying YouTube's origin validation
/// and enabling inline video playback inside the desktop app.
pub fn start_embed_server() -> u16 {
    // Try deterministic port 18290 first; if occupied, bind to port 0 for an OS-assigned ephemeral port
    let listener = TcpListener::bind("127.0.0.1:18290")
        .or_else(|_| TcpListener::bind("127.0.0.1:0"))
        .expect("Failed to bind local YouTube embed server");

    let port = listener.local_addr().expect("local addr").port();
    EMBED_PORT.store(port, Ordering::SeqCst);
    log::info!("[Terranoetis] Local YouTube embed bridge listening on http://127.0.0.1:{}", port);

    thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                thread::spawn(move || {
                    let mut buffer = [0u8; 4096];
                    let bytes_read = match stream.read(&mut buffer) {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };

                    let req = String::from_utf8_lossy(&buffer[..bytes_read]);
                    let first_line = req.lines().next().unwrap_or("");
                    let mut parts = first_line.split_whitespace();
                    let method = parts.next().unwrap_or("");
                    let path = parts.next().unwrap_or("");

                    if method == "GET" && path.starts_with("/youtube-embed") {
                        let video_id = path
                            .split('?')
                            .nth(1)
                            .and_then(|query| {
                                for pair in query.split('&') {
                                    let mut kv = pair.split('=');
                                    if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                                        if k == "v" || k == "id" {
                                            return Some(v.to_string());
                                        }
                                    }
                                }
                                None
                            })
                            .unwrap_or_default();

                        // Validate YouTube video ID (alphanumeric + hyphen + underscore)
                        let is_valid = video_id.len() >= 5
                            && video_id.len() <= 25
                            && video_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');

                        if !is_valid {
                            let body = "Invalid video ID";
                            let response = format!(
                                "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                body.len(),
                                body
                            );
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }

                        let html = format!(
                            r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>YouTube Player</title>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ width: 100%; height: 100%; overflow: hidden; background: #000; }}
    iframe {{ width: 100%; height: 100%; border: none; display: block; position: absolute; top: 0; left: 0; }}
  </style>
</head>
<body>
  <iframe
    src="https://www.youtube.com/embed/{video_id}?autoplay=1&playsinline=1"
    referrerpolicy="strict-origin-when-cross-origin"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen>
  </iframe>
</body>
</html>"#
                        );

                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.as_bytes().len(),
                            html
                        );
                        let _ = stream.write_all(response.as_bytes());
                    } else if method == "GET" && path == "/health" {
                        let body = "OK";
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(response.as_bytes());
                    } else {
                        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        let _ = stream.write_all(response.as_bytes());
                    }
                });
            }
        }
    });

    port
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_youtube_embed_server() {
        let port = start_embed_server();
        assert!(port > 0);

        // Test /health
        let mut stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).unwrap();
        let res = String::from_utf8_lossy(&buf[..n]);
        assert!(res.contains("200 OK"));
        assert!(res.contains("OK"));

        // Test /youtube-embed?v=awQzjn72bI0
        let mut stream2 = std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream2.write_all(b"GET /youtube-embed?v=awQzjn72bI0 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut buf2 = [0u8; 2048];
        let n2 = stream2.read(&mut buf2).unwrap();
        let res2 = String::from_utf8_lossy(&buf2[..n2]);
        assert!(res2.contains("200 OK"));
        assert!(res2.contains("youtube.com/embed/awQzjn72bI0"));
        assert!(res2.contains("strict-origin-when-cross-origin"));
    }
}
