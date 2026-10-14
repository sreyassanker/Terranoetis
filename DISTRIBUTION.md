# Terranoetis Desktop Distribution & Packaging Guide

This guide details the packaging, security architecture, code signing, notarization, and distribution workflows for the **Terranoetis Desktop Platform** across macOS, Windows, and Linux.

---

## 1. Architecture & Zero-Dependency Execution

Terranoetis is packaged as a native desktop application using **Tauri v2** with an embedded production Node.js intelligence engine:

- **Frontend Core**: High-performance React 19 + Cesium 3D geospatial engine, bundled with Vite and WebAssembly modules (`duckdb-wasm`, `onnxruntime-web`).
- **Backend Core**: Self-contained Node 20 ESM bundle (`dist-server/server.mjs`) compiled via `esbuild`. All 150 analytical equation models, WebSocket streams, and REST endpoints are packaged directly into the application's native bundle resources.
- **AppData Directory Isolation**: User credentials (AES-256-GCM encrypted) and SQLite state (`realtime.db`) are stored in OS application data directories:
  - **macOS**: `~/Library/Application Support/Terranoetis/`
  - **Windows**: `%APPDATA%\Terranoetis\`
  - **Linux**: `~/.local/share/terranoetis/`
- **Zero Configuration**: Users do not need to clone git repositories, run `npm install`, install Node.js, or configure environment variables.

---

## 2. Platform-Specific Packaging & Signing

### macOS (Apple Silicon & Intel Universal)

#### Artifacts
- **Disk Image**: `Terranoetis_3.0.0_aarch64.dmg` (Apple Silicon M1/M2/M3/M4) and `Terranoetis_3.0.0_x64.dmg` (Intel).
- **App Bundle**: `Terranoetis.app` located inside the DMG.

#### Signing & Notarization Workflow
1. **Developer ID Certificate**:
   Export your Apple Developer ID Application certificate as a `.p12` file and encode to Base64:
   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```
2. **Entitlements**: Configured in `src-tauri/Entitlements.plist` enabling:
   - JIT compilation for WebAssembly (`com.apple.security.cs.allow-jit`)
   - Local loopback server (`com.apple.security.network.server` on port 3001)
   - Outgoing telemetry network connections (`com.apple.security.network.client`)
3. **Notarization & Stapling**:
   ```bash
   xcrun notarytool submit Terranoetis_3.0.0_aarch64.dmg \
     --apple-id "$APPLE_ID" \
     --password "$APPLE_APP_SPECIFIC_PASSWORD" \
     --team-id "$APPLE_TEAM_ID" \
     --wait
   xcrun stapler staple Terranoetis_3.0.0_aarch64.dmg
   ```
4. **Local / Developer Gatekeeper Bypass**:
   For unsigned development builds transferred via AirDrop or downloaded via browser:
   ```bash
   xattr -cr /Applications/Terranoetis.app
   ```

---

### Windows (10 & 11, x64)

#### Artifacts
- **NSIS Setup Installer**: `Terranoetis_3.0.0_x64-setup.exe` (Recommended for end-users, per-user install without admin privileges).
- **WiX MSI Package**: `Terranoetis_3.0.0_x64_en-US.msi` (Recommended for enterprise Active Directory / Intune deployments).

#### Authenticode Code Signing
1. Sign with an EV or Standard Authenticode Certificate to prevent Windows SmartScreen ("Windows protected your PC") popups:
   ```powershell
   signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "src-tauri\target\release\bundle\nsis\Terranoetis_3.0.0_x64-setup.exe"
   ```
2. **Evergreen WebView2**:
   Terranoetis utilizes Microsoft Edge WebView2. Windows 10 (version 1803+) and Windows 11 include Evergreen WebView2 by default.

---

### Linux (Ubuntu, Debian, Fedora, Arch)

#### Artifacts
- **Universal AppImage**: `terranoetis_3.0.0_amd64.AppImage` (Runs out-of-the-box on all modern Linux distributions without root).
- **Debian Package**: `terranoetis_3.0.0_amd64.deb` (Native package for Ubuntu 20.04+, Debian 11+).

#### Installation & Permissions
- **AppImage**:
  ```bash
  chmod +x terranoetis_3.0.0_amd64.AppImage
  ./terranoetis_3.0.0_amd64.AppImage
  ```
- **DEB Package**:
  ```bash
  sudo dpkg -i terranoetis_3.0.0_amd64.deb
  sudo apt-get install -f # Resolves webkit2gtk-4.1 if missing
  ```

---

## 3. Automated Multi-Platform CI/CD (GitHub Actions)

When a version tag (e.g. `v3.0.0`) is pushed, `.github/workflows/desktop-release.yml` automatically executes parallel matrix builds across all native environments:

| Runner OS | Target Architecture | Output Artifacts |
| :--- | :--- | :--- |
| `macos-latest` | `aarch64-apple-darwin` | `Terranoetis_3.0.0_aarch64.dmg`, `.app` |
| `macos-13` | `x86_64-apple-darwin` | `Terranoetis_3.0.0_x64.dmg`, `.app` |
| `windows-latest` | `x86_64-pc-windows-msvc` | `Terranoetis_3.0.0_x64-setup.exe`, `.msi` |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `terranoetis_3.0.0_amd64.AppImage`, `.deb` |

### Required Repository Secrets for Signed Production Releases
- `APPLE_CERTIFICATE`: Base64-encoded Developer ID Application `.p12`.
- `APPLE_CERTIFICATE_PASSWORD`: Certificate password.
- `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Your Name (XXXXXXXXXX)`.
- `APPLE_ID`: Apple ID email address.
- `APPLE_PASSWORD`: App-specific password from appleid.apple.com.
- `APPLE_TEAM_ID`: 10-character Team ID.
- `TAURI_SIGNING_PRIVATE_KEY`: Tauri update / Windows signing key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password for the signing key.

---

## 4. Local Build Commands

```bash
# Build production client and server bundles
npm run build:all

# Build local macOS .app bundle
npm run desktop:build

# Build macOS .dmg installer disk image
npm run desktop:dmg

# Launch desktop app with backend intelligence
npm run desktop:run
```

---

## 5. Kaggle GPU Acceleration & Zero-Setup Integration

Terranoetis features a native, zero-dependency Kaggle integration embedded directly in the application:

1. **In-App Credential Management**:
   - Users open the **API Vault** (Key icon in the top navigation bar).
   - Under **AI & Analytics**, locate **Kaggle GPU Compute**.
   - Paste `KAGGLE_USERNAME` and `KAGGLE_KEY`, or paste the entire content of a downloaded `kaggle.json` directly into either field. The app automatically parses both fields.
2. **Zero Python / CLI Dependencies**:
   - The application communicates directly with Kaggle via native HTTPS REST endpoints (`api.kaggle.com`) for kernel pushing, status polling, and output downloading.
   - Users do **not** need to install Python, `pip install kaggle`, or manually configure system environment variables or file permissions.
3. **Encrypted Security & Storage**:
   - Credentials are encrypted using AES-256-GCM with hardware-seeded keys and stored in user AppData directories (`~/Library/Application Support/Terranoetis/` on macOS, `%APPDATA%\Terranoetis\` on Windows, `~/.local/share/terranoetis/` on Linux).
   - If an external Kaggle CLI is present, the app automatically synchronizes a local `kaggle.json` to the secure AppData runtime directory.
4. **Offline & Hybrid Local Execution**:
   - 2D physical simulations (**Wildfire Spread**, **Earthquake ShakeMap**, **Hurricane Wind + Surge**) execute locally on CPU via fast embedded numerical kernels in seconds without needing Kaggle credentials or network connectivity.
   - Heavy 3D CFD simulations (**Flood Inundation**, **Tsunami Wave Propagation**, **Volcanic Ash Plume**, **Landslide Debris Flow**) leverage the user's free 30 GPU hours/week on Kaggle GPU.
