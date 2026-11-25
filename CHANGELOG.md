# Changelog

Todos los cambios relevantes de **Vexel Launcher** se documentan en este archivo.

## [1.0.0] — 2026-11-22

### Lanzamiento Inicial Estable
- **Identidad y Packaging Windows:** Branding definitivo **Vexel Launcher**, nuevo isotipo facetado vóxel/isométrico (`icon.ico` multi-capa `16..256` + `icon.png` `512×512` + isotipo SVG dinámico en barra superior), binario `vexel-launcher.exe` e instalador NSIS (`currentUser`, Español e Inglés).
- **Motor Rust + Tauri v2:**
  - Almacenamiento híbrido (`shared/` + `instances/<id>/`), caché incremental O(1) `integrity_index.json` y motor de descargas HTTP/2 concurrente con reintentos exponenciales y renombrado atómico `.part`.
  - Selector oficial de versiones de Minecraft (`version_manifest_v2.json` con caché de 6 h y fallback offline).
  - Gestión automática de **Java 8 / 17 / 21** (Eclipse Adoptium), **Generational ZGC** (Java 21/23+) y **Aikar's G1GC**, registro Win32 de GPU de alto rendimiento, prioridad de proceso y modo desacoplado (`launch_behavior`).
  - Integración automática con **Fabric Meta API v2** y soporte completo de **Forge (`1.16.5 – 1.20.x+`)**: resolución automática de versiones (`promotions_slim.json` + fallback `maven-metadata.xml`), descarga/extracción del instalador, ejecución de *processors* de cliente con verificación SHA-1 y stamp `.forge_ready` para arranques repetidos en `<1s`, deduplicación Maven y sustitución de placeholders JVM/JPMS. Solo **NeoForge** queda pendiente para una futura versión.
  - QuickPlay a servidores y mundos individuales, y parseo limpio de logs XML de Log4j2.
- **Mundos Reales y Visor 3D:**
  - Lectura NBT nativa de `level.dat` (nombre, modo de juego, Hardcore, semilla, versión e `icon.png`), aviso preventivo ante diferencia de versión y auto-refresco al cerrar Minecraft.
  - Visor 3D WebGL (`skinview3d`) con nametag estilo Vanilla editable, carga de skins PNG y sincronización offline in-game (`v3`).
- **Mods, Resource Packs, Shaders y Worldgen:**
  - Gestor integrado de **Modrinth v2** con **stacks de optimización dinámicos por loader y versión** (**Fabric `1.16.5 – 1.21.x`** con Sodium/Lithium/ScalableLux/Starlight/Phosphor y **Forge `1.16.5 – 1.20.1+`** con Embeddium/FerriteCore/ModernFix/Radium/Canary/Starlight-Forge/Saturn), presets adaptativos de **C2ME**, **Bobby** y **Distant Horizons**, parser nativo de `fabric.mod.json` y **`META-INF/mods.toml` + `logoFile`** (con fallback `${file.jarVersion}` desde `META-INF/MANIFEST.MF`), miniaturas reales cacheadas, auto-clasificación inteligente de `.zip` y detector de `pack.mcmeta` corrupto.
  - Presupuestos equilibrados de hilos para portátiles/iGPU en **C2ME**, **Sodium** (`chunk_build_defer_mode: "ONE_FRAME"`) y **Distant Horizons** (aislando perfiles Forge exclusivamente a `DistantHorizons.toml`), más acción **"Aplicar ajustes óptimos ahora"** con respaldos automáticos `.bak` preservando controles, idioma, sonido y packs.
