# Vexel Launcher (`v1.0.0`)

[![Release](https://img.shields.io/badge/Release-v1.0.0-10b981?style=flat-square)](./CHANGELOG.md)
[![Rust](https://img.shields.io/badge/Rust-2021%20Edition-f97316?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-38bdf8?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%20x64-0ea5e9?style=flat-square&logo=windows&logoColor=white)](https://github.com/HugoSabater/mc-launcher-rust)

**Vexel Launcher** es un launcher ligero, rápido y modular para **Minecraft** construido con **Rust + Tauri v2 + React 19**, diseñado para arranques repetidos en menos de 1 segundo, perfiles completamente aislados y optimización automática pensada tanto para portátiles con iGPU como para equipos de escritorio.

---

## Características Principales

- **Arranque ultrarrápido (`<1s` en inicios repetidos):** Caché incremental `integrity_index.json` `(ruta, tamaño, mtime, sha1)` con verificación O(1) por `stat` y descargas concurrentes HTTP/2 (`Semaphore(12)`) con reintentos y renombrado atómico `.part`.
- **Selector oficial de versiones de Minecraft:** Catálogo sincronizado con Mojang `version_manifest_v2.json` con búsqueda, filtro opcional de *snapshots*, caché local de 6 horas y soporte offline automático.
- **Instancias aisladas con almacenamiento híbrido:** Deduplica assets, librerías Maven y runtimes de Java bajo `shared/`, mientras aísla por instancia `mods/`, `resourcepacks/`, `shaderpacks/`, `saves/`, `config/` y `options.txt`.
- **Mundos reales (NBT `level.dat`) y acceso directo:** Lee nombre, modo de juego (Survival/Creativo/Hardcore), semilla copiable, icono `icon.png` y versión de cada mundo, con aviso preventivo al abrir un mundo en una versión distinta y soporte QuickPlay directo a mundos o servidores.
- **Soporte nativo de Vanilla, Fabric y Forge (`1.16.5 – 1.20.x+`):** Resolución automática de versiones oficiales de **Fabric** y **Forge** (con ejecución automática de *processors* de cliente, verificación SHA-1 y stamp `.forge_ready` para evitar re-parcheos en lanzamientos repetidos). Solo **NeoForge** queda reservado para una futura versión.
- **Gestor de Mods, Resource Packs y Shaders (Modrinth v2):**
  - **Pack de FPS dinámico por loader y versión:** instala automáticamente el stack verificado para cada combinación — **Fabric `1.16.5 – 1.21.x`** (*Sodium, Lithium, FerriteCore, ImmediatelyFast, ModernFix, Entity Culling, MoreCulling, Dynamic FPS, BadOptimizations* y *ScalableLux/Starlight/Phosphor*) y **Forge `1.16.5 – 1.20.1+`** (*Embeddium, FerriteCore, ModernFix, Entity Culling, ImmediatelyFast, Dynamic FPS, BadOptimizations, Radium/Canary, Starlight-Forge* y *Saturn*) con resolución recursiva de dependencias y control de incompatibilidades.
  - Presets adaptativos para **C2ME**, **Bobby** y **Distant Horizons**, lectura nativa de `fabric.mod.json` y **`META-INF/mods.toml` + `logoFile`**, miniaturas locales extraídas de `.jar`/`.zip`, auto-clasificación inteligente de `.zip` arrastrados (*shaders* vs *resource packs*) y detector de `pack.mcmeta` corrupto.
- **Optimización real de Java, CPU y Worldgen:**
  - Descarga automática bajo demanda de **Java 8 / 17 / 21** (Eclipse Adoptium) aislado dentro del launcher sin tocar el sistema.
  - Flags JVM automáticos (**Generational ZGC** en Java 21+ con soporte Java 23+ o **Aikar's G1GC** como fallback), prioridad de proceso Win32 (`SetPriorityClass`), preferencia automática de GPU de alto rendimiento en Windows y modos de lanzamiento (`keep_open`, `hide_and_restore`, `close` desacoplado).
  - Presupuestos equilibrados de hilos para **C2ME**, **Sodium** (`chunk_build_defer_mode: "ONE_FRAME"`) y **Distant Horizons**, más botón **"Aplicar ajustes óptimos ahora"** con copias de seguridad automáticas `.bak`.
- **Visor 3D interactivo y Skin offline:** Renderizado WebGL 3D (`skinview3d`) pausado automáticamente mientras juegas, nametag estilo Vanilla editable al clic y sincronización local de skin in-game.

---

## Instalación y Desarrollo

### Requisitos previos
- **Rust Toolchain** (`rustc` + `cargo`, estable 1.80+ recomendada)
- **Node.js** (v20+ / v24 LTS) y `npm`
- **Microsoft Edge WebView2** (incluido en Windows 10/11)

### Comandos

```bash
# 1. Clonar el repositorio
git clone https://github.com/HugoSabater/mc-launcher-rust.git
cd mc-launcher-rust

# 2. Instalar dependencias del frontend y Tauri v2 CLI
npm install

# 3. Ejecutar Vexel Launcher en modo desarrollo
npm run tauri dev

# 4. Compilar el binario release y el instalador NSIS de Windows
npm run tauri build
```

### Verificación de calidad

```bash
# Backend Rust: tests completos y Clippy estricto (0 warnings)
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# Frontend: verificación estricta TypeScript + bundle Vite
npm run build
```

Para detalles completos de arquitectura interna, consulta [ARCHITECTURE.md](./ARCHITECTURE.md) y el historial de cambios en [CHANGELOG.md](./CHANGELOG.md).

---

## Créditos y Atribuciones

- **[Tauri v2](https://v2.tauri.app/)** — Runtime nativo de escritorio en Rust + WebView2.
- **[skinview3d](https://github.com/bs-community/skinview3d)** — Visor 3D WebGL de skins de Minecraft.
- **[Modrinth API v2](https://docs.modrinth.com/)** — Catálogo, búsqueda y descarga verificada de mods, resource packs y shaders.
- **[Fabric Meta API](https://meta.fabricmc.net/)** — Resolución oficial de perfiles y librerías de Fabric Loader.
- **[Minecraft Forge](https://files.minecraftforge.net/)** — Metadatos oficiales, instalador y librerías Maven de Forge.
- **[Eclipse Adoptium (Temurin)](https://adoptium.net/)** — Runtimes JRE x64 oficiales autogestionados.

---

## Aviso Legal y Licencia

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

Licenciado bajo [MIT License](./LICENSE) — Copyright © 2026 Hugo Sabater.
