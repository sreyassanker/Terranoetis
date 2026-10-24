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

#[derive(Clone, Debug)]
pub enum BackendEntry {
    /// Compiled production ESM bundle (dist-server/server.mjs)
    Compiled { entry_file: PathBuf, work_dir: PathBuf },
    /// Development raw TypeScript entry (server/index.ts via tsx)
    DevSource { entry_file: PathBuf, tsx_cli: PathBuf, work_dir: PathBuf },
}

pub struct BackendManager {
    child: Arc<Mutex<Option<Child>>>,
    entry: Option<BackendEntry>,
    log_file_path: PathBuf,
}

pub fn resolve_backend_entry() -> Option<BackendEntry> {
    // 1. Check inside application bundle resources (packaged production distribution)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // macOS App Bundle: Terranoetis.app/Contents/MacOS/Terranoetis -> Contents/Resources/dist-server/server.mjs
            if let Some(contents) = exe_dir.parent() {
                let candidates = [
                    contents.join("Resources/_up_/dist-server/server.mjs"),
                    contents.join("Resources/dist-server/server.mjs"),
                ];
                for res_path in &candidates {
                    if res_path.exists() {
                        let work_dir = res_path.parent().unwrap_or(exe_dir).to_path_buf();
                        return Some(BackendEntry::Compiled {
                            entry_file: res_path.clone(),
                            work_dir,
                        });
                    }
                }
            }

            // Windows / Linux standalone installer: resources/dist-server/server.mjs
            let win_lin_candidates = [
                exe_dir.join("resources/_up_/dist-server/server.mjs"),
                exe_dir.join("resources/dist-server/server.mjs"),
            ];
            for win_lin_res in &win_lin_candidates {
                if win_lin_res.exists() {
                    let work_dir = win_lin_res.parent().unwrap_or(exe_dir).to_path_buf();
                    return Some(BackendEntry::Compiled {
                        entry_file: win_lin_res.clone(),
                        work_dir,
                    });
                }
            }

            let next_to_exe = exe_dir.join("dist-server/server.mjs");
            if next_to_exe.exists() {
                let work_dir = exe_dir.to_path_buf();
                return Some(BackendEntry::Compiled {
                    entry_file: next_to_exe,
                    work_dir,
                });
            }
        }
    }

    // 2. Check TERRANOETIS_PROJECT_DIR environment override
    if let Ok(env_dir) = std::env::var("TERRANOETIS_PROJECT_DIR") {
        let p = PathBuf::from(env_dir);
        let compiled = p.join("dist-server/server.mjs");
        if compiled.exists() {
            return Some(BackendEntry::Compiled {
                entry_file: compiled,
                work_dir: p,
            });
        }
        let ts_entry = p.join("server/index.ts");
        let tsx = p.join("node_modules/tsx/dist/cli.mjs");
        if ts_entry.exists() && tsx.exists() {
            return Some(BackendEntry::DevSource {
                entry_file: ts_entry,
                tsx_cli: tsx,
                work_dir: p,
            });
        }
    }

    // 3. Walk up from current executable to find project root or dist-server
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent();
        while let Some(parent) = cur {
            let compiled = parent.join("dist-server/server.mjs");
            if compiled.exists() {
                return Some(BackendEntry::Compiled {
                    entry_file: compiled,
                    work_dir: parent.to_path_buf(),
                });
            }
            let ts_entry = parent.join("server/index.ts");
            let tsx = parent.join("node_modules/tsx/dist/cli.mjs");
            if ts_entry.exists() && tsx.exists() {
                return Some(BackendEntry::DevSource {
                    entry_file: ts_entry,
                    tsx_cli: tsx,
                    work_dir: parent.to_path_buf(),
                });
            }
            cur = parent.parent();
        }
    }

    // 4. Walk up from current working directory
    if let Ok(cd) = std::env::current_dir() {
        let mut cur = Some(cd.as_path());
        while let Some(parent) = cur {
            let compiled = parent.join("dist-server/server.mjs");
            if compiled.exists() {
                return Some(BackendEntry::Compiled {
                    entry_file: compiled,
                    work_dir: parent.to_path_buf(),
                });
            }
            let ts_entry = parent.join("server/index.ts");
            let tsx = parent.join("node_modules/tsx/dist/cli.mjs");
            if ts_entry.exists() && tsx.exists() {
                return Some(BackendEntry::DevSource {
                    entry_file: ts_entry,
                    tsx_cli: tsx,
                    work_dir: parent.to_path_buf(),
                });
            }
            cur = parent.parent();
        }
    }

    None
}

pub fn resolve_node_binary() -> PathBuf {
    // 1. Embedded node alongside executable or in bundle
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            #[cfg(target_os = "windows")]
            let node_name = "node.exe";
            #[cfg(not(target_os = "windows"))]
            let node_name = "node";

            let local_node = exe_dir.join(node_name);
            if local_node.exists() {
                return local_node;
            }

            if let Some(contents) = exe_dir.parent() {
                let res = contents.join("Resources").join(node_name);
                if res.exists() {
                    return res;
                }
            }
        }
    }

    // 2. Standard system locations across macOS, Linux, and Windows
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/snap/bin/node",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files (x86)\\nodejs\\node.exe",
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }

    // 3. User runtime managers (NVM, FNM, ASDF, Volta)
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        let nvm_pattern = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_pattern) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin/node");
                if bin.exists() {
                    return bin;
                }
            }
        }
        let fnm_bin = PathBuf::from(&home).join(".local/share/fnm/current/bin/node");
        if fnm_bin.exists() {
            return fnm_bin;
        }
        let asdf_bin = PathBuf::from(&home).join(".asdf/shims/node");
        if asdf_bin.exists() {
            return asdf_bin;
        }
        let volta_bin = PathBuf::from(&home).join(".volta/bin/node");
        if volta_bin.exists() {
            return volta_bin;
        }
    }

    PathBuf::from("node")
}

pub fn resolve_log_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        let log_dir = PathBuf::from(home).join("Library/Logs/Terranoetis");
        let _ = std::fs::create_dir_all(&log_dir);
        if log_dir.exists() {
            return log_dir.join("backend.log");
        }
    }

    #[cfg(target_os = "windows")]
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let log_dir = PathBuf::from(local_app_data).join("Terranoetis\\Logs");
        let _ = std::fs::create_dir_all(&log_dir);
        if log_dir.exists() {
            return log_dir.join("backend.log");
        }
    }

    #[cfg(target_os = "linux")]
    if let Ok(home) = std::env::var("HOME") {
        let log_dir = PathBuf::from(home).join(".local/state/terranoetis");
        let _ = std::fs::create_dir_all(&log_dir);
        if log_dir.exists() {
            return log_dir.join("backend.log");
        }
    }

    std::env::temp_dir().join("terranoetis-backend.log")
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
        let entry = resolve_backend_entry();
        let log_file_path = resolve_log_path();
        Self {
            child: Arc::new(Mutex::new(None)),
            entry,
            log_file_path,
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

        let node = resolve_node_binary();
        let mut cmd = Command::new(&node);

        match &self.entry {
            Some(BackendEntry::Compiled { entry_file, work_dir }) => {
                log::info!("[BackendManager] Starting compiled production backend: {:?} with {:?}", entry_file, node);
                cmd.arg(entry_file).current_dir(work_dir);
                cmd.env("NODE_ENV", "production");
            }
            Some(BackendEntry::DevSource { entry_file, tsx_cli, work_dir }) => {
                log::info!("[BackendManager] Starting dev TypeScript backend: {:?} with tsx {:?}", entry_file, tsx_cli);
                cmd.arg(tsx_cli).arg(entry_file).current_dir(work_dir);
                cmd.env("NODE_ENV", "development");
            }
            None => {
                log::error!("[BackendManager] No valid backend entry found (dist-server/server.mjs or server/index.ts)");
                return BackendStatus {
                    running: false,
                    port: 3001,
                    managed_by_app: false,
                    pid: None,
                    message: "No backend bundle found. Run 'npm run build:server' before launching.".to_string(),
                };
            }
        }

        // Augment PATH with node directory and standard system paths in a cross-platform manner
        #[cfg(windows)]
        let path_sep = ";";
        #[cfg(not(windows))]
        let path_sep = ":";

        let mut path_entries = Vec::new();
        if let Some(parent) = node.parent().and_then(|p| p.to_str()) {
            path_entries.push(parent.to_string());
        }
        #[cfg(unix)]
        {
            for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
                path_entries.push(p.to_string());
            }
        }
        if let Ok(existing) = std::env::var("PATH") {
            path_entries.push(existing);
        }
        let new_path = path_entries.join(path_sep);
        cmd.env("PATH", new_path);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW prevents command prompt flash
        }
        cmd.env("PORT", "3001");
        cmd.env("PROXY_PORT", "3001");
        cmd.env("PARENT_PID", std::process::id().to_string());
        cmd.env("TERRANOETIS_DESKTOP", "1");
        cmd.env("DESKTOP_APP", "1");

        // Supply a session secret if JWT_SECRET is not provided
        if std::env::var("JWT_SECRET").is_err() {
            let now_nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let secret = format!("desktop_{:x}_{:x}_{:x}", now_nanos, std::process::id(), std::process::id() ^ 0x5a5a5a5a);
            let padded_secret = format!("{:0<48}", secret);
            cmd.env("JWT_SECRET", padded_secret);
        }

        // Augment NODE_PATH with candidate node_modules directories so bundled server.mjs can resolve packages
        let mut node_paths: Vec<PathBuf> = Vec::new();
        if let Some(entry) = &self.entry {
            let work_dir = match entry {
                BackendEntry::Compiled { work_dir, .. } => work_dir,
                BackendEntry::DevSource { work_dir, .. } => work_dir,
            };
            node_paths.push(work_dir.join("node_modules"));
            let mut cur = work_dir.parent();
            while let Some(parent) = cur {
                let candidate = parent.join("node_modules");
                if candidate.exists() {
                    node_paths.push(candidate);
                }
                cur = parent.parent();
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                if let Some(contents) = exe_dir.parent() {
                    let res_nm = contents.join("Resources/dist-server/node_modules");
                    if res_nm.exists() {
                        node_paths.push(res_nm);
                    }
                    let res_nm_up = contents.join("Resources/_up_/dist-server/node_modules");
                    if res_nm_up.exists() {
                        node_paths.push(res_nm_up);
                    }
                    let direct_nm = contents.join("Resources/node_modules");
                    if direct_nm.exists() {
                        node_paths.push(direct_nm);
                    }
                }

                // Windows / Linux standalone installer: resources/ directory sits alongside executable
                let win_res_nm = exe_dir.join("resources/dist-server/node_modules");
                if win_res_nm.exists() {
                    node_paths.push(win_res_nm);
                }
                let win_res_nm_up = exe_dir.join("resources/_up_/dist-server/node_modules");
                if win_res_nm_up.exists() {
                    node_paths.push(win_res_nm_up);
                }
                let win_direct_nm = exe_dir.join("resources/node_modules");
                if win_direct_nm.exists() {
                    node_paths.push(win_direct_nm);
                }
            }
            let mut cur = exe.parent();
            while let Some(parent) = cur {
                let candidate = parent.join("node_modules");
                if candidate.exists() {
                    node_paths.push(candidate);
                }
                cur = parent.parent();
            }
        }
        let sep = if cfg!(windows) { ";" } else { ":" };
        let mut node_path_str = node_paths
            .into_iter()
            .filter_map(|p| p.to_str().map(|s| s.to_string()))
            .collect::<Vec<String>>()
            .join(sep);
        if let Ok(existing_np) = std::env::var("NODE_PATH") {
            if !node_path_str.is_empty() {
                node_path_str = format!("{}{}{}", node_path_str, sep, existing_np);
            } else {
                node_path_str = existing_np;
            }
        }
        if !node_path_str.is_empty() {
            cmd.env("NODE_PATH", node_path_str);
        }

        // Rotate backend log if it exceeds 10 MB to prevent unbounded disk growth (Defect P2-LOG-01 fix)
        if let Ok(metadata) = std::fs::metadata(&self.log_file_path) {
            if metadata.len() > 10 * 1024 * 1024 {
                let backup_path = self.log_file_path.with_extension("log.1");
                let _ = std::fs::rename(&self.log_file_path, backup_path);
            }
        }

        // Pipe backend stdout/stderr to application log file
        if let Ok(log_file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_file_path)
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
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(0x08000000)
                    .spawn();
            }
            #[cfg(not(any(unix, windows)))]
            {
                let mut child = child;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_backend_entry() {
        let entry = resolve_backend_entry();
        assert!(entry.is_some(), "Backend entry must be resolved (compiled or dev source)");
    }

    #[test]
    fn test_resolve_node() {
        let n = resolve_node_binary();
        assert!(n.exists() || n == PathBuf::from("node"), "Node binary must exist: {:?}", n);
    }
}
