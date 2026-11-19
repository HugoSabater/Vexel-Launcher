# Arquitectura Técnica — `mc-launcher-rust`

## 1. Visión General y Principios de Diseño

`mc-launcher-rust` está diseñado para maximizar la velocidad de arranque del launcher (`<1s` en ejecuciones posteriores), reducir la latencia del sistema de archivos y eliminar pausas de Garbage Collection o contención de CPU mientras Minecraft está corriendo.

- **Backend 100% Asíncrono (`tokio`):** Ninguna operación de disco (`tokio::fs`), red (`reqwest` HTTP/2) o subproceso (`tokio::process::Command`) bloquea el hilo principal. Las operaciones síncronas intensivas de CPU (extracción de `.zip` en `java.rs` y `runner.rs`) se aíslan en `tokio::task::spawn_blocking`.
- **Cero `.unwrap()` / `.expect()`:** El crate impone `#![deny(clippy::unwrap_used, clippy::expect_used)]`. Todos los errores fluyen hacia `AppError` (`thiserror`), serializable hacia el frontend como `{ code, message }`.
- **Portabilidad Open-Source:** Todas las rutas se resuelven en tiempo de ejecución mediante `directories::ProjectDirs::from("com", "mclauncher", "mc-launcher-rust")`, sin dependencias a directorios personales o rutas absolutas fijas.
- **IPC sin Saturación (`tauri::ipc::Channel<T>`):** El progreso multi-fase (verificación, descargas paralelas, instalación de Java y logs en vivo de `javaw.exe`) se transmite por canales dedicados de Tauri v2, evitando sobrecargar el bus de eventos globales.

---

## 2. Sistema de Archivos Híbrido (`<data_root>`)

Compartir un único `.minecraft` entre versiones corrompe `options.txt` y configuraciones de mods; duplicar assets y librerías por perfil desperdicia gigabytes en disco. La arquitectura híbrida separa recursos inmutables compartidos de datos mutables por instancia:

```text
<data_root>/
├── config.json                         # Configuración global, hardware presets y perfiles
├── shared/
│   ├── assets/
│   │   ├── indexes/                    # Índices JSON de assets de Mojang
│   │   └── objects/<xx>/<sha1>         # Objetos inmutables deduplicados por hash
│   ├── libraries/                      # Librerías Maven .jar compartidas
│   ├── versions/<version_id>/          # Manifests JSON y client.jar por versión
│   ├── runtimes/java-<major>/          # JREs de Eclipse Adoptium autogestionados
│   └── cache/
│       └── integrity_index.json        # Índice incremental (size + mtime + sha1)
└── instances/<profile_id>/             # --gameDir aislado por perfil
    ├── mods/                           # .jar activos y .jar.disabled
    ├── resourcepacks/                  # .zip activos y .zip.disabled
    ├── shaderpacks/
    ├── saves/
    └── natives/                        # .dll nativas extraídas para la sesión
```

---

## 3. Arranque en `<1s`: Índice Incremental (`integrity_index.json`)

Validar ~3.000 assets calculando `SHA-1` desde SSD en cada clic de **JUGAR** introduce segundos de latencia innecesaria. `downloader.rs` implementa una validación en dos niveles:

1. **Fast-Path O(1) por `stat`:** Consulta `tokio::fs::metadata` (`len()` y `modified()` en segundos Unix). Si `(size, mtime_secs)` coinciden exactamente con la entrada registrada en `integrity_index.json` y el `sha1` indexado coincide con el requerido por el manifiesto, se da el archivo por verificado sin leer su contenido.
2. **Slow-Path y Descarga Paralela Controlada:** Solo los archivos nuevos o modificados en tamaño/`mtime` se leen para verificar su `SHA-1` real o se descargan en paralelo mediante `reqwest::Client` (HTTP/2 con connection pooling) acotado por `tokio::sync::Semaphore(12)` para no saturar routers domésticos ni Windows Defender. Las descargas escriben primero a `.part`, verifican el `SHA-1` al vuelo y hacen `rename` atómico. El índice se persiste atómicamente (`integrity_index.json.tmp` -> `rename`).

---

## 4. Módulos Core Desacoplados (`src-tauri/src/core/`)

| Módulo | Responsabilidad |
| :--- | :--- |
| `paths.rs` | Resolución portable de `<data_root>` y creación asíncrona de la jerarquía híbrida. |
| `hardware.rs` | Lectura de RAM física y núcleos lógicos con `sysinfo`; cálculo de presets seguros (≤8 GB, 16 GB, ≥32 GB) para evitar pausas de GC por exceso de heap. |
| `jvm_optimizer.rs` | Generación dinámica de flags JVM: **Generational ZGC** (`-XX:+UseZGC -XX:+ZGenerational`) en Java 21+ o **Aikar's G1GC** optimizado con escalado automático (`<12 GB` vs `>=12 GB`) y fallback seguro en Java 8/17. |
| `manifest.rs` | Descarga y parsing de `version_manifest_v2.json`, `<version>.json` (soportando `arguments` moderno y `minecraftArguments` clásico) y `assetIndex`, con evaluación de reglas `os.name == "windows"`. |
| `java.rs` | Detección de `shared/runtimes/java-<v>/bin/javaw.exe` y descarga/extracción streaming desde **Eclipse Adoptium API** eliminando el prefijo de carpeta raíz del `.zip`. |
| `downloader.rs` | Verificación rápida con `integrity_index.json` y motor de descargas concurrente (`Semaphore(12)`). |
| `runner.rs` | Extracción de `.dll` nativas, UUID offline determinista RFC 4122 v3 (`OfflinePlayer:<username>`), QuickPlay (`--quickPlayMultiplayer` en `>=1.20`, `--server`/`--port` en `<1.20`), prioridad Win32 vía `windows-sys` (`SetPriorityClass`) y streaming de logs por `Channel`. |
| `instance.rs` | Persistencia atómica de `config.json` y gestión de perfiles aislados. |
| `content.rs` | Escaneo/toggle (`.jar`/`.zip` ↔ `.disabled`), importación de archivos y cliente de **Modrinth API v2** para inyectar el stack de rendimiento (Sodium, Lithium, FerriteCore, ImmediatelyFast, C2ME, Distant Horizons). |
| `loaders.rs` | Integración con **Fabric Meta API v2** y arquitectura extensible (`LoaderMetadataProvider`) para Forge y NeoForge con soporte `inheritsFrom`. |

---

## 5. Tuning del Sistema Operativo y Modo Cero Overhead

- **Prioridad Win32 (`windows-sys`):** Tras lanzar `javaw.exe`, `runner.rs` abre un handle con `PROCESS_SET_INFORMATION` y aplica `ABOVE_NORMAL_PRIORITY_CLASS` o `HIGH_PRIORITY_CLASS` según la configuración del usuario, cerrando siempre el handle de forma segura.
- **Modo Cero Overhead:** Cuando `close_on_launch` está activado, la ventana WebView2 de Tauri se oculta (`window.hide()`) inmediatamente tras confirmar el arranque del proceso hijo, liberando memoria y recursos de GPU mientras Minecraft se ejecuta.
