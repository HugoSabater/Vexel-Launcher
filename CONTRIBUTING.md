# Contributing to `mc-launcher-rust`

Thank you for your interest in contributing! To keep the codebase fast, safe, and maintainable, please follow these engineering standards before opening a Pull Request.

## Branching & Commit Convention

1. Fork the repository and create a descriptive branch from `main`:
   - `feat/<feature-name>` for new capabilities
   - `fix/<bug-name>` for bug fixes
   - `style/<ui-change>` for UI/UX refinements
   - `docs/<topic>` for documentation updates
2. Follow Conventional Commits (`feat(...)`, `fix(...)`, `style(...)`, `docs(...)`, `refactor(...)`).

## Coding Standards

- **Zero `.unwrap()` / `.expect()`:** All Rust code in `src-tauri/src/` is compiled with `#![deny(clippy::unwrap_used, clippy::expect_used)]`. Propagate errors explicitly through `AppError` (`src-tauri/src/error.rs`).
- **Async-First:** Use `tokio` for all network, filesystem, and subprocess I/O. Wrap blocking CPU/archive work inside `tokio::task::spawn_blocking`.
- **Tauri v2 Only:** Use `src-tauri/capabilities/` for permissions and `tauri::ipc::Channel<T>` for streaming progress/logs.
- **No Hardcoded Paths:** Resolve all runtime directories through `LauncherPaths` (`directories` crate).
- **Strict TypeScript:** Keep `strict: true`, `noUnusedLocals: true`, and `noUnusedParameters: true` clean with zero `any`.

## Mandatory Pre-PR Verification

Every Pull Request must pass all four checks with **0 errors and 0 warnings**:

```bash
# Backend (from src-tauri/)
cargo check
cargo clippy --all-targets -- -D warnings
cargo test

# Frontend (from repository root)
npm run build
```
