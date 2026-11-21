import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  Minus,
  Search,
  Square,
  X,
} from "lucide-react";
import {
  ConsoleDrawer,
  createLogStore,
  formatLocalHms,
  type LogStore,
} from "./components/ConsoleDrawer";
import { ContentManagerPanel } from "./components/ContentManagerPanel";
import { ProfileDashboard } from "./components/ProfileDashboard";
import {
  SettingsPerformancePanel,
  type SettingsSection,
} from "./components/SettingsPerformancePanel";
import {
  SidebarProfiles,
  type MainView,
} from "./components/SidebarProfiles";
import { ACCENT_PALETTE } from "./theme/accents";
import type {
  BootstrapState,
  ContentItem,
  ContentKind,
  GlobalSettingsPayload,
  InstalledJavaRuntime,
  InstanceExitEvent,
  InstanceSummary,
  IpcErrorPayload,
  JavaRuntimeStatus,
  JvmTuningOutput,
  LauncherConfig,
  LaunchProgressEvent,
  LaunchResult,
  LiveMemoryTelemetry,
  LogCleanupResult,
  LogLineEvent,
  ModrinthSearchResult,
  ModrinthSort,
  PerformancePreset,
  Profile,
  StorageBreakdown,
} from "./types/launcher";

interface CrashToastState {
  profileName: string;
  exitCode: number;
}

function extractIpcError(err: unknown): IpcErrorPayload {
  if (typeof err === "object" && err !== null) {
    return err as IpcErrorPayload;
  }
  if (typeof err === "string") {
    try {
      return JSON.parse(err) as IpcErrorPayload;
    } catch {
      return { message: err };
    }
  }
  return { message: "Error desconocido en IPC" };
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [activeView, setActiveView] = useState<MainView>("home");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("instance");
  const [skinDataUrl, setSkinDataUrl] = useState<string | null>(null);
  const [jvmTuning, setJvmTuning] = useState<JvmTuningOutput | null>(null);
  const [launching, setLaunching] = useState(false);
  const [runningProfiles, setRunningProfiles] = useState<
    Record<string, boolean>
  >({});
  const [installingJava, setInstallingJava] = useState(false);
  const [missingJavaMajor, setMissingJavaMajor] = useState<number | null>(null);
  const [javaInstallProgress, setJavaInstallProgress] =
    useState<LaunchProgressEvent | null>(null);
  const [progress, setProgress] = useState<LaunchProgressEvent | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [crashToast, setCrashToast] = useState<CrashToastState | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const logStoreRef = useRef<LogStore | null>(null);
  if (logStoreRef.current === null) {
    logStoreRef.current = createLogStore(500);
  }
  const logStore = logStoreRef.current;
  const isAnyInstanceRunning = Object.keys(runningProfiles).length > 0;

  const handleWindowMinimize = () => {
    try {
      void getCurrentWindow().minimize();
    } catch {
      // Browser fallback
    }
  };

  const handleWindowToggleMaximize = () => {
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {
      // Browser fallback
    }
  };

  const handleWindowClose = () => {
    try {
      void getCurrentWindow().close();
    } catch {
      // Browser fallback
    }
  };

  // Apply dynamic CSS accent color variables
  useEffect(() => {
    const key = bootstrap?.config.accent_color ?? "emerald";
    const theme = ACCENT_PALETTE[key] ?? ACCENT_PALETTE.emerald;
    const root = document.documentElement.style;
    root.setProperty("--accent-primary", theme.main);
    root.setProperty("--accent-primary-hover", theme.hover);
    root.setProperty("--accent-soft", theme.soft);
    root.setProperty("--accent-border", theme.border);
    root.setProperty("--accent-foreground", theme.foreground);
  }, [bootstrap?.config.accent_color]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setConsoleOpen((open) => !open);
      } else if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickQuery("");
        setQuickSearchOpen((open) => !open);
      } else if (event.key === "Escape") {
        setQuickSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const [data, skin] = await Promise.all([
        invoke<BootstrapState>("get_bootstrap_state"),
        invoke<string | null>("get_player_skin_data").catch(() => null),
      ]);
      setBootstrap(data);
      setSkinDataUrl(skin);
      const def =
        data.config.profiles.find((p) => p.is_default) ??
        data.config.profiles[0];
      if (def) {
        setSelectedProfileId((prev) =>
          prev && data.config.profiles.some((p) => p.id === prev)
            ? prev
            : def.id,
        );
      }
    } catch (err) {
      const parsed = extractIpcError(err);
      setBannerError(
        parsed.message ??
          "No se pudo conectar con el backend Tauri v2. Ejecuta `npm run tauri dev`.",
      );
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const selectedProfile = useMemo(() => {
    if (!bootstrap) return null;
    return (
      bootstrap.config.profiles.find((p) => p.id === selectedProfileId) ??
      bootstrap.config.profiles[0] ??
      null
    );
  }, [bootstrap, selectedProfileId]);

  const refreshProfileMetadata = useCallback(async (profile: Profile) => {
    let javaMajor = 21;
    try {
      const status = await invoke<JavaRuntimeStatus>("check_profile_java", {
        mcVersion: profile.mc_version,
      });
      javaMajor = status.major;
    } catch {
      // Fallback 21
    }

    try {
      const tuning = await invoke<JvmTuningOutput>("get_jvm_flags_preview", {
        javaMajor,
        ramMb: profile.ram_mb,
        gcPreset: profile.gc_preset,
      });
      setJvmTuning(tuning);
    } catch {
      setJvmTuning(null);
    }
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      void refreshProfileMetadata(selectedProfile);
    }
  }, [selectedProfile, refreshProfileMetadata]);

  const updateConfigState = (nextConfig: LauncherConfig) => {
    setBootstrap((prev) => (prev ? { ...prev, config: nextConfig } : prev));
  };

  const handleSaveProfile = async (profile: Profile) => {
    const nextConfig = await invoke<LauncherConfig>(
      "create_or_update_profile",
      { profile },
    );
    updateConfigState(nextConfig);
  };

  const handleDuplicateProfile = async (source: Profile) => {
    const copy: Profile = {
      ...source,
      id: `${source.id}-copy-${Date.now().toString(36).slice(-4)}`,
      name: `${source.name} (Copia)`,
      is_default: false,
    };
    await handleSaveProfile(copy);
    setSelectedProfileId(copy.id);
  };

  const handleSetDefault = async (profileId: string) => {
    const nextConfig = await invoke<LauncherConfig>("set_default_profile", {
      profileId,
    });
    updateConfigState(nextConfig);
  };

  const handleDeleteProfile = async (profileId: string) => {
    const nextConfig = await invoke<LauncherConfig>("remove_profile", {
      profileId,
    });
    updateConfigState(nextConfig);
    if (selectedProfileId === profileId && nextConfig.profiles[0]) {
      setSelectedProfileId(nextConfig.profiles[0].id);
    }
  };

  const handleOpenFolder = async (profileId: string) => {
    try {
      await invoke("open_instance_folder", { profileId });
    } catch (err) {
      setBannerError(
        extractIpcError(err).message ?? "No se pudo abrir la carpeta",
      );
    }
  };

  const handleOpenSavesFolder = async (profileId: string) => {
    try {
      await invoke("open_instance_saves_folder", { profileId });
    } catch (err) {
      setBannerError(
        extractIpcError(err).message ?? "No se pudo abrir saves/",
      );
    }
  };

  const handleOpenDataRoot = async () => {
    try {
      await invoke("open_data_root_folder");
    } catch (err) {
      setBannerError(
        extractIpcError(err).message ?? "No se pudo abrir la carpeta raíz",
      );
    }
  };

  const handleSaveGlobalSettings = async (settings: GlobalSettingsPayload) => {
    try {
      const nextConfig = await invoke<LauncherConfig>("save_global_settings", {
        settings,
      });
      setBannerError(null);
      updateConfigState(nextConfig);
    } catch (err) {
      const msg = extractIpcError(err).message ?? "Error guardando ajustes";
      setBannerError(msg);
      throw new Error(msg);
    }
  };

  const handleUpdateUsername = async (nick: string) => {
    if (!bootstrap) return;
    await handleSaveGlobalSettings({
      offline_username: nick,
      process_priority: bootstrap.config.process_priority,
      close_on_launch: bootstrap.config.close_on_launch,
      apply_skin_ingame: bootstrap.config.apply_skin_ingame,
      accent_color: bootstrap.config.accent_color,
      launch_behavior: bootstrap.config.launch_behavior,
      auto_open_console_on_crash: bootstrap.config.auto_open_console_on_crash,
    });
  };

  const handleUploadSkinBytes = async (bytes: number[]) => {
    try {
      const dataUrl = await invoke<string>("upload_custom_skin_bytes", {
        bytes,
      });
      setBannerError(null);
      setSkinDataUrl(dataUrl);
    } catch (err) {
      const msg = extractIpcError(err).message ?? "Error al subir skin PNG";
      setBannerError(msg);
      throw new Error(msg);
    }
  };

  const handleSetSkinModel = async (model: "classic" | "slim") => {
    const nextConfig = await invoke<LauncherConfig>("set_skin_model", {
      model,
    });
    updateConfigState(nextConfig);
  };

  const handlePlayProfile = async (
    targetProfileId?: string,
    worldFolder?: string,
  ) => {
    const profileToRun =
      (targetProfileId
        ? bootstrap?.config.profiles.find((p) => p.id === targetProfileId)
        : selectedProfile) ?? null;

    if (!profileToRun || runningProfiles[profileToRun.id]) return;
    if (profileToRun.loader === "forge" || profileToRun.loader === "neo_forge") {
      setBannerError(
        "El soporte directo para Forge/NeoForge llegará próximamente. Cambia a Vanilla o Fabric para lanzar.",
      );
      return;
    }

    const autoOpenCrash =
      bootstrap?.config.auto_open_console_on_crash ?? true;

    setBannerError(null);
    setCrashToast(null);
    setLaunching(true);
    logStore.clear();

    const onProgress = new Channel<LaunchProgressEvent>();
    onProgress.onmessage = (ev) => {
      setProgress(ev);
    };

    const onLog = new Channel<LogLineEvent>();
    onLog.onmessage = (ev) => {
      logStore.push(ev);
    };

    const onExit = new Channel<InstanceExitEvent>();
    onExit.onmessage = (ev) => {
      setRunningProfiles((prev) => {
        const next = { ...prev };
        delete next[ev.profile_id];
        return next;
      });
      setProgress(null);

      if (ev.exit_code !== null && ev.exit_code !== 0) {
        setCrashToast({
          profileName: profileToRun.name,
          exitCode: ev.exit_code,
        });
        if (autoOpenCrash) {
          setConsoleOpen(true);
        }
      }
    };

    try {
      const result = await invoke<LaunchResult>("launch_profile", {
        profileId: profileToRun.id,
        worldFolder: worldFolder ?? null,
        onProgress,
        onLog,
        onExit,
      });
      setRunningProfiles((prev) => ({ ...prev, [profileToRun.id]: true }));
      logStore.push({
        line: `[Launcher] Proceso activo PID ${result.pid} · Fast-Path O(1): ${result.fast_path_hits} · Descargados: ${result.downloaded_files}`,
        is_stderr: false,
        timestamp_ms: Date.now(),
      });
    } catch (err) {
      const parsed = extractIpcError(err);
      if (parsed.code === "JAVA_NOT_FOUND" && parsed.required_major) {
        setMissingJavaMajor(parsed.required_major);
      } else {
        setBannerError(parsed.message ?? "Fallo al lanzar Minecraft");
      }
    } finally {
      setLaunching(false);
    }
  };

  const handleStopProfile = async (targetProfileId?: string) => {
    const id = targetProfileId ?? selectedProfile?.id;
    if (!id) return;
    try {
      await invoke("stop_instance", { profileId: id });
      setRunningProfiles((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setBannerError(
        extractIpcError(err).message ?? "Error al detener proceso",
      );
    }
  };

  const handleInstallJavaMajorOnly = async (major: number) => {
    const onProgress = new Channel<LaunchProgressEvent>();
    onProgress.onmessage = (ev) => {
      setProgress(ev);
    };
    try {
      setBannerError(null);
      await invoke<JavaRuntimeStatus>("install_adoptium_java", {
        major,
        onProgress,
      });
    } catch (err) {
      const msg =
        extractIpcError(err).message ??
        `Error instalando Eclipse Temurin Java ${major}`;
      setBannerError(msg);
      throw new Error(msg);
    } finally {
      setProgress(null);
    }
  };

  const handleConfirmInstallJava = async (major: number) => {
    setInstallingJava(true);
    setBannerError(null);
    setJavaInstallProgress({
      phase: "Descargando JRE...",
      completed: 0,
      total: 100,
      bytes_downloaded: 0,
      detail: `Conectando con Eclipse Adoptium (Java ${major})...`,
      fast_path_hits: 0,
    });

    const onProgress = new Channel<LaunchProgressEvent>();
    onProgress.onmessage = (ev) => {
      setJavaInstallProgress(ev);
      setProgress(ev);
    };

    try {
      await invoke<JavaRuntimeStatus>("install_adoptium_java", {
        major,
        onProgress,
      });
      setMissingJavaMajor(null);
      setJavaInstallProgress(null);
      await handlePlayProfile();
    } catch (err) {
      const parsed = extractIpcError(err);
      setBannerError(parsed.message ?? "Error descargando Java desde Adoptium");
    } finally {
      setInstallingJava(false);
    }
  };

  const handleCopyReport = async () => {
    const report = logStore
      .getSnapshot()
      .map((l) => `[${formatLocalHms(l.timestamp_ms)}] ${l.line}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(report || "Sin líneas de log.");
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleListContent = useCallback(
    async (profileId: string, kind: ContentKind) =>
      invoke<ContentItem[]>("list_profile_content", { profileId, kind }),
    [],
  );

  const handleGetInstanceSummary = useCallback(
    async (profileId: string) =>
      invoke<InstanceSummary>("get_instance_summary", { profileId }),
    [],
  );

  const handleGetDynamicRecommendations = useCallback(
    async (
      profileId: string,
      category: string,
      kind: ContentKind,
      offset = 0,
      sort: ModrinthSort = "downloads",
    ) =>
      invoke<ModrinthSearchResult[]>("get_dynamic_recommendations", {
        profileId,
        category,
        kind,
        offset,
        sort,
      }),
    [],
  );

  const handleSearchModrinth = useCallback(
    async (
      profileId: string,
      query: string,
      mcVersion: string,
      loader: string,
      kind: ContentKind,
      offset = 0,
      sort: ModrinthSort = "relevance",
    ) =>
      invoke<ModrinthSearchResult[]>("search_modrinth", {
        profileId,
        query,
        mcVersion,
        loader,
        kind,
        offset,
        sort,
      }),
    [],
  );

  const handleToggleContent = useCallback(
    async (
      profileId: string,
      kind: ContentKind,
      fileName: string,
      enable: boolean,
    ) =>
      invoke<ContentItem>("toggle_profile_content", {
        profileId,
        kind,
        fileName,
        enable,
      }),
    [],
  );

  const handleDeleteContent = useCallback(
    async (profileId: string, kind: ContentKind, fileName: string) =>
      invoke<void>("delete_profile_content", {
        profileId,
        kind,
        fileName,
      }),
    [],
  );

  const handleImportContent = useCallback(
    async (profileId: string, kind: ContentKind, sourcePath: string) =>
      invoke<ContentItem>("import_profile_content", {
        profileId,
        kind,
        sourcePath,
      }),
    [],
  );

  const handleImportContentBytes = useCallback(
    async (
      profileId: string,
      kind: ContentKind,
      fileName: string,
      bytes: number[],
    ) =>
      invoke<ContentItem>("import_profile_content_bytes", {
        profileId,
        kind,
        fileName,
        bytes,
      }),
    [],
  );

  const handleInjectPreset = useCallback(
    async (
      profileId: string,
      preset: PerformancePreset,
      onProgressCb: (ev: LaunchProgressEvent) => void,
    ) => {
      const channel = new Channel<LaunchProgressEvent>();
      channel.onmessage = onProgressCb;
      return invoke<string[]>("inject_performance_preset", {
        profileId,
        preset,
        onProgress: channel,
      });
    },
    [],
  );

  const handleInstallModrinthItem = useCallback(
    async (
      profileId: string,
      slug: string,
      kind: ContentKind,
      onProgressCb: (ev: LaunchProgressEvent) => void,
    ) => {
      const channel = new Channel<LaunchProgressEvent>();
      channel.onmessage = onProgressCb;
      return invoke<string[]>("install_modrinth_item", {
        profileId,
        slug,
        kind,
        onProgress: channel,
      });
    },
    [],
  );

  const handleListInstalledJavas = useCallback(
    async () => invoke<InstalledJavaRuntime[]>("list_installed_javas"),
    [],
  );

  const handleGetStorageBreakdown = useCallback(
    async () => invoke<StorageBreakdown>("get_storage_breakdown"),
    [],
  );

  const handleRevalidateCache = useCallback(
    async () => invoke<void>("revalidate_cache_index"),
    [],
  );

  const handleCleanOldLogs = useCallback(
    async () => invoke<LogCleanupResult>("clean_old_logs"),
    [],
  );

  const handleGetLaunchCommandPreview = useCallback(
    async (profileId: string) =>
      invoke<string>("get_launch_command_preview", { profileId }),
    [],
  );

  const handleGetLiveMemoryTelemetry = useCallback(
    async () => invoke<LiveMemoryTelemetry>("get_live_memory_telemetry"),
    [],
  );

  const filteredProfiles = useMemo(() => {
    if (!bootstrap) return [];
    const q = quickQuery.trim().toLowerCase();
    if (!q) return bootstrap.config.profiles;
    return bootstrap.config.profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.mc_version.toLowerCase().includes(q) ||
        p.loader.toLowerCase().includes(q),
    );
  }, [bootstrap, quickQuery]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#080A0F] text-slate-100 flex flex-col border border-[#1E2534]">
      {/* 36px Frameless Top Titlebar with Quick Search (Ctrl+K) */}
      <header
        data-tauri-drag-region
        className="h-9 shrink-0 bg-[#080A0F] border-b border-[#1E2534] px-3 flex items-center justify-between gap-4"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 pl-0.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "var(--accent-primary)" }}
          />
          <span
            data-tauri-drag-region
            className="text-xs font-semibold tracking-tight text-slate-200"
          >
            MC Launcher
          </span>
          <span
            data-tauri-drag-region
            className="rounded bg-[var(--accent-soft)] border border-[var(--accent-border)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--accent-primary)]"
          >
            RUST
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setQuickQuery("");
            setQuickSearchOpen(true);
          }}
          className="h-6 w-72 max-w-[40vw] rounded-md bg-[#11151E] hover:bg-[#171D2A] border border-[#1E2534] px-2.5 flex items-center justify-between text-[11px] text-slate-500 transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <Search className="h-3 w-3 text-slate-500" />
            Buscar instancias...
          </span>
          <span className="font-mono text-[10px] text-slate-600">Ctrl+K</span>
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleWindowMinimize}
            title="Minimizar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#171D2A]"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleWindowToggleMaximize}
            title="Maximizar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#171D2A]"
          >
            <Square className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            onClick={handleWindowClose}
            title="Cerrar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      {!bootstrap || !selectedProfile ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <p className="text-xs font-mono text-slate-400">
            {bannerError ?? "Inicializando..."}
          </p>
        </main>
      ) : (
        <div className="relative flex-1 flex min-h-0">
          <SidebarProfiles
            profiles={bootstrap.config.profiles}
            selectedProfileId={selectedProfile.id}
            runningProfileIds={runningProfiles}
            activeView={activeView}
            consoleOpen={consoleOpen}
            offlineUsername={bootstrap.config.offline_username}
            hardware={bootstrap.hardware}
            onSelectProfile={setSelectedProfileId}
            onSelectView={(v) => {
              if (v === "performance") setSettingsSection("instance");
              setActiveView(v);
            }}
            onToggleConsole={() => setConsoleOpen((v) => !v)}
            onUpdateUsername={handleUpdateUsername}
            onPlayProfile={(id) => handlePlayProfile(id)}
            onStopProfile={(id) => handleStopProfile(id)}
            onOpenFolder={handleOpenFolder}
            onDuplicateProfile={handleDuplicateProfile}
            onSetDefault={handleSetDefault}
            onSaveProfile={handleSaveProfile}
            onDeleteProfile={handleDeleteProfile}
          />

          <div className="relative flex-1 flex flex-col min-w-0 min-h-0">
            {bannerError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 rounded-lg bg-[#11151E] border border-rose-500/40 px-4 py-2 text-xs font-mono text-rose-200 flex items-center gap-3 shadow-xl">
                <span>{bannerError}</span>
                <button
                  type="button"
                  onClick={() => setBannerError(null)}
                  className="text-rose-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Smart Crash Toast */}
            {crashToast && (
              <div className="absolute top-4 right-4 z-40 w-80 rounded-xl bg-[#11151E] border border-rose-500/40 p-3.5 shadow-2xl space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-white">
                        El juego se cerró inesperadamente (Código{" "}
                        {crashToast.exitCode})
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {crashToast.profileName}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCrashToast(null)}
                    className="text-slate-500 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConsoleOpen(true);
                      setCrashToast(null);
                    }}
                    className="flex-1 rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] py-1.5 text-[11px] font-medium text-white"
                  >
                    Ver consola
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyReport()}
                    className="flex-1 rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] py-1.5 text-[11px] font-medium text-[var(--accent-primary)]"
                  >
                    {copiedLogs ? "Copiado" : "Copiar reporte"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0">
              {activeView === "home" && (
                <ProfileDashboard
                  profile={selectedProfile}
                  config={bootstrap.config}
                  skinDataUrl={skinDataUrl}
                  launching={launching}
                  isRunning={Boolean(runningProfiles[selectedProfile.id])}
                  isAnyRunning={isAnyInstanceRunning}
                  progress={progress}
                  missingJavaMajor={missingJavaMajor}
                  installingJava={installingJava}
                  javaInstallProgress={javaInstallProgress}
                  onListContent={handleListContent}
                  onGetInstanceSummary={handleGetInstanceSummary}
                  onUpdateUsername={handleUpdateUsername}
                  onUploadSkinBytes={handleUploadSkinBytes}
                  onPlay={() => handlePlayProfile()}
                  onPlayWorld={(folder) =>
                    handlePlayProfile(selectedProfile.id, folder)
                  }
                  onStop={() => handleStopProfile()}
                  onOpenFolder={() => handleOpenFolder(selectedProfile.id)}
                  onOpenSavesFolder={() =>
                    handleOpenSavesFolder(selectedProfile.id)
                  }
                  onOpenMods={() => setActiveView("content")}
                  onOpenSettings={() => {
                    setSettingsSection("instance");
                    setActiveView("performance");
                  }}
                  onConfirmInstallJava={handleConfirmInstallJava}
                  onDismissJavaModal={() => {
                    setMissingJavaMajor(null);
                    setJavaInstallProgress(null);
                  }}
                />
              )}

              {activeView === "content" && (
                <ContentManagerPanel
                  profile={selectedProfile}
                  onListContent={handleListContent}
                  onGetDynamicRecommendations={handleGetDynamicRecommendations}
                  onSearchModrinth={handleSearchModrinth}
                  onToggleContent={handleToggleContent}
                  onDeleteContent={handleDeleteContent}
                  onImportContent={handleImportContent}
                  onImportContentBytes={handleImportContentBytes}
                  onInjectPreset={handleInjectPreset}
                  onInstallItem={handleInstallModrinthItem}
                />
              )}

              {activeView === "performance" && (
                <SettingsPerformancePanel
                  profile={selectedProfile}
                  config={bootstrap.config}
                  hardware={bootstrap.hardware}
                  jvmTuning={jvmTuning}
                  skinDataUrl={skinDataUrl}
                  isAnyRunning={isAnyInstanceRunning}
                  dataRoot={bootstrap.data_root}
                  initialSection={settingsSection}
                  onUpdateProfile={handleSaveProfile}
                  onSaveGlobalSettings={handleSaveGlobalSettings}
                  onUploadSkinBytes={handleUploadSkinBytes}
                  onSetSkinModel={handleSetSkinModel}
                  onOpenDataRoot={handleOpenDataRoot}
                  onListInstalledJavas={handleListInstalledJavas}
                  onInstallJavaMajor={handleInstallJavaMajorOnly}
                  onGetStorageBreakdown={handleGetStorageBreakdown}
                  onRevalidateCache={handleRevalidateCache}
                  onCleanOldLogs={handleCleanOldLogs}
                  onGetLaunchCommandPreview={handleGetLaunchCommandPreview}
                  onGetLiveMemoryTelemetry={handleGetLiveMemoryTelemetry}
                />
              )}
            </div>

            {/* Slide-Up Console Drawer (Ctrl+L) */}
            {consoleOpen && (
              <ConsoleDrawer
                logStore={logStore}
                onClose={() => setConsoleOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* Ctrl+K Quick Search Palette */}
      {quickSearchOpen && bootstrap && (
        <div
          onClick={() => setQuickSearchOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/70 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-[#11151E] border border-[#1E2534] overflow-hidden shadow-2xl"
          >
            <div className="px-3.5 py-2.5 border-b border-[#1E2534] flex items-center gap-2">
              <Search className="h-4 w-4 text-[var(--accent-primary)]" />
              <input
                type="text"
                autoFocus
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder="Cambiar instancia por nombre, versión o loader..."
                className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
              />
              <span className="text-[10px] font-mono text-slate-600">ESC</span>
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
              {filteredProfiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedProfileId(p.id);
                    setActiveView("home");
                    setQuickSearchOpen(false);
                  }}
                  className="w-full rounded-lg px-3 py-2 flex items-center justify-between text-left hover:bg-[#171D2A] text-xs"
                >
                  <span className="text-slate-200 font-medium">{p.name}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {p.mc_version} · {p.loader}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
