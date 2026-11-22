# Arquitectura Técnica — **Vexel Launcher**

## 1. Visión General y Principios de Diseño

**Vexel Launcher** (`v1.0.0`) está diseñado para maximizar la velocidad de arranque (`<1s` en inicios repetidos), reducir la latencia del sistema de archivos, evitar la sobre-suscripción de hilos en portátiles/iGPU y eliminar el overhead de UI mientras Minecraft está ejecutándose.

- **Backend 100% Asíncrono (`tokio`):** Todas las operaciones de disco (`tokio::fs`), red (`reqwest` HTTP/2 con pooling y reintentos) y subprocesos (`tokio::process::Command`) son asíncronas. Las tareas síncronas de CPU o archivos comprimidos (extracción de `.zip`, inspección de `.jar`/`pack.mcmeta`, lectura NBT de `level.dat`, telemetría `sysinfo`) se aíslan en `tokio::task::spawn_blocking`.
- **Cero `.unwrap()` / `.expect()` en producción:** El crate impone `#![deny(clippy::unwrap_used, clippy::expect_used)]`. Todos los errores se tipan en `AppError` (`thiserror`), serializable al frontend como `{ code, message, required_major }` y traducido a español claro.
- **Portabilidad y compatibilidad de datos locales:** El directorio raíz de datos se resuelve mediante `directories::ProjectDirs::from("com", "mclauncher", "mc-launcher-rust")` (conservando el identificador `mc-launcher-rust` en disco para garantizar compatibilidad total con instancias, mundos y skins ya existentes).
- **IPC de alta frecuencia (`tauri::ipc::Channel<T>`):** El progreso de descargas, instalación de Java, salida de consola y notificación de cierre (`InstanceExitEvent`) se transmiten por canales dedicados de Tauri v2, sin saturar el bus global de eventos.
- **Seguridad y Single-Instance:** CSP estricta en `tauri.conf.json` (fuentes `Inter`, `JetBrains Mono` y fuente pixel de Minecraft empaquetadas 100% offline), validación de rutas/IDs contra path traversal y guarda RAII *single-instance* mediante Named Mutex Win32 (`Local\com.vexel.launcher.single_instance`).

---

## 2. Sistema de Archivos Híbrido (`<data_root>`)

Compartir un único `.minecraft` entre versiones corrompe `options.txt` y configuraciones de mods; duplicar assets y librerías por perfil desperdicia gigabytes. La arquitectura híbrida separa recursos inmutables compartidos de datos mutables por instancia:

```text
<data_root>/                            # %LOCALAPPDATA%\mclauncher\mc-launcher-rust\data
├── config.json                         # Configuración global y registro de perfiles aislados
├── shared/
│   ├── assets/
│   │   ├── indexes/                    # Índices JSON de assets de Mojang
│   │   ├── objects/<xx>/<sha1>         # Objetos inmutables deduplicados por hash SHA-1
│   │   └── log_configs/                # Configuración XML Log4j2 de Mojang
│   ├── libraries/                      # Librerías Maven .jar compartidas
│   ├── versions/<version_id>/          # Manifiestos JSON y client.jar por versión
│   ├── runtimes/java-<major>/          # JREs de Eclipse Adoptium autogestionados (8/17/21)
│   ├── skins/                          # Skin personalizada PNG del jugador
│   └── cache/
│       ├── integrity_index.json        # Índice incremental O(1) (size + mtime + sha1)
│       └── version_manifest_v2.json    # Caché oficial de versiones de Mojang (TTL 6h + offline)
└── instances/<profile_id>/             # --gameDir aislado por instancia
    ├── .content_index.json             # Metadatos locales, IDs Modrinth, iconos y estado pack.mcmeta
    ├── .content_icons/                 # Caché local de miniaturas PNG extraídas (≤256 KB)
    ├── .launcher_skin.sha1             # Stamp v3 de sincronización de skin offline
    ├── options.txt                     # Opciones del juego (con respaldo .bak al re-optimizar)
    ├── config/                         # Configs de mods (sodium-options.json, c2me.toml, DistantHorizons.toml)
    ├── mods/                           # .jar activos y .jar.disabled
    ├── resourcepacks/                  # .zip activos y .zip.disabled
    ├── shaderpacks/                    # .zip de shaders activos y .zip.disabled
    ├── saves/                          # Mundos Minecraft (level.dat NBT + icon.png)
    ├── screenshots/                    # Capturas usadas como fondo ambiental en portada
    └── natives/<mc_version>/           # .dll nativas extraídas con caché .natives_stamp
```

---

## 3. Arranque en `<1s`: Índice Incremental (`integrity_index.json`)

Validar ~3.000 assets calculando `SHA-1` desde SSD en cada clic de **JUGAR** añade segundos innecesarios. `downloader.rs` aplica validación en dos niveles:

1. **Fast-Path O(1) por `stat`:** Consulta `tokio::fs::metadata` (`len()` y `modified()` en segundos Unix). Si `(size, mtime_secs)` y el `sha1` indexado coinciden con el manifiesto, el archivo se valida sin leerlo de disco.
2. **Slow-Path y Descarga Paralela Controlada:** Solo archivos ausentes o modificados se verifican o descargan en paralelo mediante `reqwest::Client` (HTTP/2 con `Semaphore(12)` y hasta 3 intentos con backoff exponencial). Cada descarga escribe en `<archivo>.part`, valida su `SHA-1` al vuelo y realiza `rename` atómico.

---

## 4. Módulos Core Desacoplados (`src-tauri/src/core/`)

| Módulo | Responsabilidad |
| :--- | :--- |
| `paths.rs` | Resolución portable de `<data_root>` (`ProjectDirs`) y creación asíncrona de la jerarquía híbrida compartida y por instancia. |
| `hardware.rs` | Detección de RAM física y núcleos lógicos con `sysinfo`, presets seguros de memoria (4/8/16/32+ GB) y telemetría de RAM/RSS en vivo separada entre sistema y procesos de Minecraft. |
| `jvm_optimizer.rs` | Generación dinámica de flags JVM: **Generational ZGC** en Java 21+ (omitiendo `-XX:+ZGenerational` obsoleto en Java 23+) o **Aikar's G1GC** optimizado con fallback automático en Java 8/17 y baja RAM. |
| `manifest.rs` | Catálogo oficial `version_manifest_v2.json` con caché de 6 h y fallback offline, descarga/parsing de `<version>.json` y `assetIndex`, reglas `os.name == "windows"` y configuración `logging.client`. |
| `java.rs` | Detección de `shared/runtimes/java-<v>/bin/javaw.exe`, sondeo real de versión mayor (`java -version`) y descarga/extracción streaming desde **Eclipse Adoptium API**. |
| `downloader.rs` | Verificación rápida O(1) con `integrity_index.json` y motor concurrente HTTP/2 (`Semaphore(12)`) con reintentos exponenciales y archivos `.part` sin colisión de extensión. |
| `runner.rs` | Extracción de nativas con `.natives_stamp`, registro HKCU de preferencia de GPU de alto rendimiento, identidad `Vexel Launcher` (`-Dminecraft.launcher.brand`/version), QuickPlay singleplayer y multiplayer, prioridad Win32 (`SetPriorityClass`), modo desacoplado (`CREATE_NO_WINDOW \| CREATE_NEW_PROCESS_GROUP` + `Stdio::null`), merge quirúrgico de `options.txt` con respaldo `.bak` y parseo limpio de eventos XML Log4j (`Log4jStreamParser`). |
| `instance.rs` | Persistencia atómica de `config.json`, recuperación ante archivos corruptos, migración retroactiva de `close_on_launch` a `launch_behavior` y gestión de perfiles. |
| `content.rs` | Inventario/toggle/eliminación de mods, packs y shaders, extracción cacheada de iconos locales (`.content_icons/`), cliente **Modrinth API v2** (Pack de FPS de 10 mods con **ScalableLux**, C2ME, Bobby, Distant Horizons, resolución de dependencias e incompatibilidades activas), auto-clasificación `.zip` (`shaders/` vs `pack.mcmeta`) y detector de `pack.mcmeta` corrupto. |
| `loaders.rs` | Integración con **Fabric Meta API v2** con fusión de librerías Maven y descriptores extensibles para Forge y NeoForge (`inheritsFrom`). |
| `worlds.rs` | Lector binario NBT puro (soporte GZip y los 12 tipos de tag NBT sin panics) para `level.dat`, extracción de nombre, modo de juego, Hardcore, versión, semilla `i64` e `icon.png`. |
| `worldgen_configs.rs` | Generación inicial (solo si faltan) y re-optimización segura con respaldo `.bak` de `sodium-options.json` (`chunk_builder_threads = (cores/4).clamp(2,4)`, `chunk_build_defer_mode: "ONE_FRAME"`), `c2me.toml` (`globalExecutorParallelism = (cores/3).clamp(2,4)`, `LOW`) y `DistantHorizons.toml` únicamente para mods activos. |
| `skin_pack.rs` | Generación y sincronización cacheada (`v3:` en `.launcher_skin.sha1`) del micro-pack offline de skin personalizada y actualización segura de `resourcePacks` en `options.txt`. |

---

## 5. Tuning del Sistema Operativo y Modos de Lanzamiento (`launch_behavior`)

- **Preferencia GPU y Prioridad Win32 (`windows-sys`):** Antes de lanzar el juego, `runner.rs` registra `javaw.exe` con `GpuPreference=2;` en `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`. Tras crear el proceso, aplica `NORMAL`, `ABOVE_NORMAL` o `HIGH` mediante `SetPriorityClass` cerrando siempre el handle.
- **Comportamiento al abrir Minecraft (`launch_behavior`):**
  - `"keep_open"`: mantiene Vexel Launcher abierto pausando el visor WebGL 3D (`skinview3d`) y el polling cuando la ventana queda oculta.
  - `"hide_and_restore"`: oculta la ventana WebView2 (`window.hide()`) al lanzar el juego y la restaura automáticamente al terminar la partida refrescando *Mundos Recientes*.
  - `"close"`: lanza Minecraft completamente desacoplado (`Stdio::null()` + `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`) y cierra el launcher sin interrumpir el juego.
