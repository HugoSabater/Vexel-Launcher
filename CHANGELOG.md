# Changelog

Todos los cambios relevantes de **Vexel Launcher** se documentan en este archivo.

## [1.1.0] — 2026-11-26

### Nuevas Funcionalidades
- **Soporte Completo de NeoForge (`1.20.4 – 1.21.x+`):**
  - Resolución automática de versiones desde `maven-metadata.xml` (caché 6 h en `shared/cache/neoforge/` + fallback offline) priorizando releases estables frente a `-beta`, compartiendo el motor de *processors* de cliente con Forge (`CREATE_NO_WINDOW`, verificación SHA-1, sello atómico `.neoforge_ready` y deduplicación Maven).
  - Parser nativo prioritario de `META-INF/neoforge.mods.toml` (`logoFile` + fallback `${file.jarVersion}` desde `META-INF/MANIFEST.MF`), stacks de FPS verificados en Modrinth (`1.20.x` Embeddium 8 mods; `1.21.0–1.21.1` Sodium + ScalableLux 10 mods; `>= 1.21.2` Sodium + Noisium 10 mods) y tuning automático de `sodium-options.json` + `DistantHorizons.toml`.
  - Los 4 loaders (**Vanilla, Fabric, Forge y NeoForge**) completamente operativos en creación, edición, Modrinth y lanzamiento.
- **Importar y Exportar Instancias (`.mrpack` de Modrinth):**
  - Importación segura con validación de `formatVersion == 1`, detección automática de versión/loader, filtrado `env.client == "unsupported"`, protección estricta anti *path traversal*, URLs estrictamente `https://`, descargas concurrentes verificadas con `SHA-1` y `SHA-512` y extracción de `overrides/` + `client-overrides/`.
  - Exportación con resolución batch en Modrinth (`POST /v2/version_files`), empaquetado de mods locales en `overrides/`, inclusión opcional de `config/` y exclusión estricta de `saves/`, `logs/`, `crash-reports/`, `natives/` y archivos internos del launcher.
- **Centralizador de Controles y Juego (Diseño Minecraft-Native):**
  - Plantilla portable en `shared/global_options.json` con merge quirúrgico (preserva CRLF/LF, gráficos, `resourcePacks` y crea copias de seguridad automáticas `.bak`) y auto-aplicación en nuevas instancias y modpacks `.mrpack`.
  - Interfaz nativa en 3 pestañas (**Música y Sonido**, **Controles y Ratón**, **Cámara e Interfaz**) con deslizadores anchos estilo Minecraft de **precisión al 1%** (y edición numérica al doble clic), los **10 canales de audio**, asignación interactiva de teclado/ratón con detección de conflictos y restablecimiento por tecla.
- **Aviso Discreto de Actualizaciones:**
  - Comprobación *best-effort* con caché de 24 h contra GitHub Releases y píldora discreta en la barra superior con apertura segura de enlaces oficiales.

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
