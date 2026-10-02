use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct BackendStatus {
    pub running: bool,
    pub port: u16,
    pub managed_by_app: bool,
    pub pid: Option<u32>,
    pub message: String,
}

pub struct BackendManager {
    child: Arc<Mutex<Option<Child>>>,
    project_dir: PathBuf,
}

pub fn find_project_dir() -> PathBuf {
    // 1. Env override
    if let Ok(p) = std::env::var("TERRANOETIS_PROJECT_DIR") {
        let pb = PathBuf::from(p);
        if pb.join("package.json").exists() {
            return pb;
        }
    }

    // 2. Walk up from current exe
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent();
        while let Some(parent) = cur {
            if parent.join("package.json").exists() && parent.join("server/index.ts").exists() {
                return parent.to_path_buf();
            }
            cur = parent.parent();
        }
    }

    // 3. Current dir
    if let Ok(cd) = std::env::current_dir() {
        let mut cur = Some(cd.as_path());
        while let Some(parent) = cur {
            if parent.join("package.json").exists() && parent.join("server/index.ts").exists() {
                return parent.to_path_buf();
            }
            cur = parent.parent();
        }
    }

    // 4. Default fallback on local installation
    let default_path = PathBuf::from("/Users/sreyassanker/Downloads/Terranoetis");
    if default_path.exists() {
        return default_path;
    }

    PathBuf::from(".")
}

fn find_node() -> PathBuf {
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    // Check ~/.nvm/versions/node/*/bin/node
    if let Ok(home) = std::env::var("HOME") {
        let nvm_pattern = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_pattern) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin/node");
                if bin.exists() {
                    return bin;
                }
            }
        }
    }
    PathBuf::from("node")
}

pub fn is_port_open(port: u16) -> bool {
    let addr_str = format!("127.0.0.1:{}", port);
    if let Ok(addr) = addr_str.parse() {
        TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
    } else {
        false
    }
}

impl BackendManager {
    pub fn new() -> Self {
        let project_dir = find_project_dir();
        Self {
            child: Arc::new(Mutex::new(None)),
            project_dir,
        }
    }

    pub fn start(&self) -> BackendStatus {
        let mut lock = self.child.lock().unwrap();

        // If port 3001 is already listening:
        if is_port_open(3001) {
            let pid = lock.as_ref().map(|c| c.id());
            return BackendStatus {
                running: true,
                port: 3001,
                managed_by_app: lock.is_some(),
                pid,
                message: "Backend server is already running on port 3001".to_string(),
            };
        }

        let node = find_node();
        let tsx_cli = self.project_dir.join("node_modules/tsx/dist/cli.mjs");
        let server_entry = self.project_dir.join("server/index.ts");

        log::info!(
            "[BackendManager] Starting backend: {:?} {:?} {:?}",
            node,
            tsx_cli,
            server_entry
        );

        let mut cmd = Command::new(&node);
        cmd.arg(&tsx_cli)
            .arg(&server_entry)
            .current_dir(&self.project_dir);

        // Augment PATH with node directory and standard paths
        let mut new_path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string();
        if let Some(parent) = node.parent().and_then(|p| p.to_str()) {
            new_path = format!("{}:{}", parent, new_path);
        }
        if let Ok(existing) = std::env::var("PATH") {
            new_path = format!("{}:{}", new_path, existing);
        }
        cmd.env("PATH", new_path);
        cmd.env("PORT", "3001");
        cmd.env("PARENT_PID", std::process::id().to_string());

        // Pipe backend stdout/stderr to backend.log in project root
        if let Ok(log_file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.project_dir.join("backend.log"))
        {
            if let Ok(err_file) = log_file.try_clone() {
                cmd.stdout(std::process::Stdio::from(log_file));
                cmd.stderr(std::process::Stdio::from(err_file));
            }
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0); // Create new process group for clean subtree kill
        }

        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id();
                *lock = Some(child);
                log::info!("[BackendManager] Spawned backend process with PID {}", pid);

                // Wait up to 15 seconds in background for port 3001
                std::thread::spawn(move || {
                    for _ in 0..75 {
                        std::thread::sleep(Duration::from_millis(200));
                        if is_port_open(3001) {
                            log::info!("[BackendManager] Backend port 3001 is listening!");
                            break;
                        }
                    }
                });

                BackendStatus {
                    running: true,
                    port: 3001,
                    managed_by_app: true,
                    pid: Some(pid),
                    message: "Backend server launched successfully".to_string(),
                }
            }
            Err(e) => {
                log::error!("[BackendManager] Failed to spawn backend: {:?}", e);
                BackendStatus {
                    running: false,
                    port: 3001,
                    managed_by_app: false,
                    pid: None,
                    message: format!("Failed to spawn backend: {}", e),
                }
            }
        }
    }

    pub fn stop(&self) -> BackendStatus {
        let mut lock = self.child.lock().unwrap();
        if let Some(child) = lock.take() {
            let pid = child.id() as i32;
            log::info!("[BackendManager] Stopping backend process group PID {}", pid);

            #[cfg(unix)]
            unsafe {
                libc::kill(-pid, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }

            // Give it 500ms then ensure termination
            std::thread::sleep(Duration::from_millis(500));
            #[cfg(unix)]
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
        }

        BackendStatus {
            running: is_port_open(3001),
            port: 3001,
            managed_by_app: false,
            pid: None,
            message: "Backend stopped".to_string(),
        }
    }

    pub fn status(&self) -> BackendStatus {
        let lock = self.child.lock().unwrap();
        let running = is_port_open(3001);
        let pid = lock.as_ref().map(|c| c.id());
        BackendStatus {
            running,
            port: 3001,
            managed_by_app: lock.is_some(),
            pid,
            message: if running {
                "Backend server active on port 3001".to_string()
            } else {
                "Backend server offline".to_string()
            },
        }
    }
}
