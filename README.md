# MC Launcher Rust

[![Rust](https://img.shields.io/badge/Rust-2021%20Edition-f97316?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-38bdf8?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%20x64-0ea5e9?style=flat-square&logo=windows&logoColor=white)](https://github.com/HugoSabater/mc-launcher-rust)

A lightweight, modular, open-source Minecraft launcher engineered in **Rust + Tauri v2 + React 19** for sub-second repeat launches, automatic JVM/OS performance tuning, and isolated modded profiles.

---

## Key Highlights

- **Sub-Second Repeat Launch (`<1s`):** Uses an incremental `integrity_index.json` `(path, size, mtime, sha1)` fast-path so subsequent launches validate thousands of Mojang assets via `stat` in O(1) without re-reading gigabytes from SSD.
- **Hybrid Storage Architecture:** Deduplicates immutable assets, Maven libraries, version manifests, and Adoptium JRE runtimes under `shared/`, while isolating each profile's `mods/`, `resourcepacks/`, `shaderpacks/`, `saves/`, and `options.txt` inside `instances/<profile_id>/`.
- **Automatic Hardware & JVM Tuning:** Inspects host RAM and logical cores (`sysinfo`) to recommend safe heap sizes and generates **Generational ZGC** (`-XX:+UseZGC -XX:+ZGenerational`, `<1ms` GC pauses on Java 21+) or **Aikar's G1GC** flags with automatic safe fallback on Java 8/17.
- **OS-Level Windows Tuning:** Applies `ABOVE_NORMAL_PRIORITY_CLASS` or `HIGH_PRIORITY_CLASS` to the spawned `javaw.exe` process via Win32 (`windows-sys`) and supports **Zero-Overhead Mode** to hide WebView2 as soon as Minecraft starts.
- **Modrinth Performance Stack (1-Click):** Automatically resolves and installs **Sodium, Lithium, FerriteCore, ImmediatelyFast, C2ME, and Distant Horizons** for Fabric profiles directly from the Modrinth v2 API.
- **Managed Adoptium JRE Runtimes:** Reads `javaVersion.majorVersion` from Mojang manifests and downloads/extracts official Eclipse Temurin JREs on demand with streaming progress over `tauri::ipc::Channel<T>`.
- **Native QuickPlay Direct Connect:** Launches straight into multiplayer servers (`--quickPlayMultiplayer` on MC `>= 1.20`, `--server`/`--port` on `< 1.20`).

---

## Architecture & Performance

```text
<portable_data_root>/
├── config.json                         # Global settings & isolated profile registry
├── shared/
│   ├── assets/                         # Immutable Mojang indexes & SHA-1 objects
│   ├── libraries/                      # Deduplicated Maven .jar libraries
│   ├── versions/<mc_version>/          # Cached manifests & client.jar
│   ├── runtimes/java-<major>/          # Managed Eclipse Adoptium JREs
│   └── cache/integrity_index.json      # O(1) stat-based integrity cache
└── instances/<profile_id>/             # Isolated --gameDir per profile
    ├── mods/                           # .jar / .jar.disabled instant toggles
    ├── resourcepacks/                  # .zip / .zip.disabled instant toggles
    ├── shaderpacks/
    ├── saves/
    └── natives/                        # Extracted session .dll natives
```

### Core Engineering Guarantees
- **100% Async I/O (`tokio`):** All disk, HTTP/2 (`reqwest` + `Semaphore(12)`), and process I/O is asynchronous; ZIP extraction is isolated in `tokio::task::spawn_blocking`.
- **Zero `.unwrap()` / `.expect()`:** Enforced at compile time via `#![deny(clippy::unwrap_used, clippy::expect_used)]` with a central serializable `AppError` (`thiserror`).
- **Tauri v2 Capabilities & Channels:** Uses strict `src-tauri/capabilities/default.json` ACLs and `tauri::ipc::Channel<T>` for high-frequency progress and live JVM stdout/stderr streaming.

For full architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Installation & Development

### Prerequisites
- **Rust Toolchain** (`rustc` + `cargo`, stable 1.80+ recommended)
- **Node.js** (v20+ / v24 LTS) & `npm`
- **Microsoft Edge WebView2** (pre-installed on Windows 10/11)

### Commands

```bash
# 1. Clone the repository
git clone https://github.com/HugoSabater/mc-launcher-rust.git
cd mc-launcher-rust

# 2. Install frontend & Tauri v2 CLI dependencies
npm install

# 3. Run the native desktop app in development mode
npm run tauri dev

# 4. Build a production installer (.msi / .exe)
npm run tauri build
```

### Quality Verification

```bash
# Rust checks, strict lints, and unit tests
cd src-tauri
cargo check
cargo clippy --all-targets -- -D warnings
cargo test

# Frontend strict TypeScript check and production bundle
cd ..
npm run build
```

---

## Roadmap

- [x] **Core Engine:** Hybrid filesystem, `integrity_index.json` O(1) cache, HTTP/2 12-way downloader, Adoptium JRE manager, ZGC/G1GC optimizer, Win32 priority tuning, QuickPlay.
- [x] **Content & UI:** Obsidian Studio frameless UI, isolated profiles, `.jar`/`.zip` instant toggle, drag & drop import, 1-click Modrinth Performance Stack.
- [x] **Fabric Integration:** Automatic Fabric Meta API v2 profile resolution and Maven library merging.
- [ ] **Forge & NeoForge Processors:** Complete execution pipeline for Forge/NeoForge installer post-processors (building on the existing Maven descriptors in `loaders.rs`).
- [ ] **Cross-Platform Support:** Linux (`nice`/`renice` priority) and macOS (`arm64`/`x64` Adoptium & LWJGL native classifiers).

---

## License

Licensed under the [MIT License](./LICENSE) — Copyright © 2026 Hugo Sabater.
