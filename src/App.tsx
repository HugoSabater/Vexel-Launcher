import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ArrowUpRight,
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
import { extractIpcError, formatFriendlyError } from "./utils/errors";
import type {
  ApplyGlobalOptionsResult,
  BootstrapState,
  ContentItem,
  ContentKind,
  GlobalGameOptions,
  GlobalSettingsPayload,
  InstalledJavaRuntime,
  InstanceExitEvent,
  InstanceSummary,
  JavaRuntimeStatus,
  JvmTuningOutput,
  LauncherConfig,
  LaunchProgressEvent,
  LaunchResult,
  LiveMemoryTelemetry,
  LogCleanupResult,
  LogLineEvent,
  MinecraftVersionEntry,
  ModrinthSearchResult,
  ModrinthSort,
  MrpackExportResult,
  MrpackImportResult,
  OptimizationStackInfo,
  PerformancePreset,
  Profile,
  ReoptimizeResult,
  SaveGlobalGameOptionsPayload,
  StorageBreakdown,
  UpdateCheckResult,
} from "./types/launcher";

interface CrashToastState {
  profileName: string;
  exitCode: number;
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [activeView, setActiveView] = useState<MainView>("home");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("instance");
  const [skinDataUrl, setSkinDataUrl] = useState<string | null>(null);
  const [mcVersions, setMcVersions] = useState<MinecraftVersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const [jvmTuning, setJvmTuning] = useState<JvmTuningOutput | null>(null);
  const [launchingProfileId, setLaunchingProfileId] = useState<string | null>(
    null,
  );
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
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const configRef = useRef<LauncherConfig | null>(null);
  configRef.current = bootstrap?.config ?? null;
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
    root.setProperty("--accent-rgb", theme.rgb);
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
      setBannerError(
        formatFriendlyError(
          err,
          "No se pudo iniciar Vexel Launcher. Cierra y vuelve a abrir la aplicación.",
        ),
      );
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  // Fetch official Minecraft version catalog in background (cached 6h + offline fallback)
  useEffect(() => {
    let cancelled = false;
    setLoadingVersions(true);
    void invoke<MinecraftVersionEntry[]>("list_minecraft_versions")
      .then((list) => {
        if (!cancelled) setMcVersions(list);
      })
      .catch(() => {
        // Offline with empty cache: VersionPicker falls back gracefully to manual input
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });
    void invoke<UpdateCheckResult>("check_launcher_update")
      .then((res) => {
        if (!cancelled && res.update_available) setUpdateInfo(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProfile = useMemo(() => {
    if (!bootstrap) return null;
    return (
      bootstrap.config.profiles.find((p) => p.id === selectedProfileId) ??
      bootstrap.config.profiles[0] ??
      null
    );
  }, [bootstrap, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfile) return;
    let cancelled = false;

    void (async () => {
      let javaMajor = 21;
      try {
        const status = await invoke<JavaRuntimeStatus>("check_profile_java", {
          mcVersion: selectedProfile.mc_version,
          customJavaPath: selectedProfile.custom_java_path,
        });
        javaMajor = status.major;
      } catch {
        // Fallback 21
      }

      if (cancelled) return;
      try {
        const tuning = await invoke<JvmTuningOutput>("get_jvm_flags_preview", {
          javaMajor,
          ramMb: selectedProfile.ram_mb,
          gcPreset: selectedProfile.gc_preset,
        });
        if (!cancelled) setJvmTuning(tuning);
      } catch {
        if (!cancelled) setJvmTuning(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProfile]);

  const updateConfigState = (nextConfig: LauncherConfig) => {
    setBootstrap((prev) => (prev ? { ...prev, config: nextConfig } : prev));
  };

  const handleSaveProfile = async (profile: Profile): Promise<boolean> => {
    try {
      const nextConfig = await invoke<LauncherConfig>(
        "create_or_update_profile",
        { profile },
      );
      setBannerError(null);
      updateConfigState(nextConfig);
      return true;
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudieron guardar los cambios."),
      );
      return false;
    }
  };

  const handleDuplicateProfile = async (source: Profile) => {
    const copy: Profile = {
      ...source,
      id: `${source.id}-copy-${Date.now().toString(36).slice(-4)}`,
      name: `${source.name} (Copia)`,
      is_default: false,
    };
    const ok = await handleSaveProfile(copy);
    if (ok) {
      setSelectedProfileId(copy.id);
    }
  };

  const handleSetDefault = async (profileId: string) => {
    try {
      const nextConfig = await invoke<LauncherConfig>("set_default_profile", {
        profileId,
      });
      setBannerError(null);
      updateConfigState(nextConfig);
    } catch (err) {
      setBannerError(
        formatFriendlyError(
          err,
          "No se pudo fijar la instancia predeterminada.",
        ),
      );
    }
  };

  const handleDeleteProfile = async (
    profileId: string,
    deleteFiles: boolean,
  ) => {
    try {
      const nextConfig = await invoke<LauncherConfig>("remove_profile", {
        profileId,
        deleteFiles,
      });
      setBannerError(null);
      updateConfigState(nextConfig);
      if (selectedProfileId === profileId && nextConfig.profiles[0]) {
        setSelectedProfileId(nextConfig.profiles[0].id);
      }
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudo eliminar la instancia."),
      );
    }
  };

  const handleOpenFolder = async (profileId: string) => {
    try {
      await invoke("open_instance_folder", { profileId });
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudo abrir la carpeta de la instancia."),
      );
    }
  };

  const handleOpenSavesFolder = async (profileId: string) => {
    try {
      await invoke("open_instance_saves_folder", { profileId });
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudo abrir la carpeta de mundos."),
      );
    }
  };

  const handleOpenDataRoot = async () => {
    try {
      await invoke("open_data_root_folder");
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudo abrir la carpeta de datos."),
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
      const msg = formatFriendlyError(err, "No se pudieron guardar los ajustes.");
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
      auto_tune_mod_configs: bootstrap.config.auto_tune_mod_configs,
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
      const msg = formatFriendlyError(
        err,
        "No se pudo guardar la skin. Comprueba que es un archivo PNG válido.",
      );
      setBannerError(msg);
      throw new Error(msg);
    }
  };

  const handleSetSkinModel = async (model: "classic" | "slim") => {
    try {
      const nextConfig = await invoke<LauncherConfig>("set_skin_model", {
        model,
      });
      setBannerError(null);
      updateConfigState(nextConfig);
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudo cambiar el modelo de brazos."),
      );
    }
  };

  const handlePlayProfile = async (
    targetProfileId?: string,
    worldFolder?: string,
  ) => {
    const profileToRun =
      (targetProfileId
        ? bootstrap?.config.profiles.find((p) => p.id === targetProfileId)
        : selectedProfile) ?? null;

    if (
      !profileToRun ||
      runningProfiles[profileToRun.id] ||
      launchingProfileId !== null
    ) {
      return;
    }

    setBannerError(null);
    setCrashToast(null);
    setLaunchingProfileId(profileToRun.id);
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
      setSummaryRefreshKey((k) => k + 1);

      if (ev.exit_code !== null && ev.exit_code !== 0) {
        const latestCfg = configRef.current;
        const latestName =
          latestCfg?.profiles.find((p) => p.id === ev.profile_id)?.name ??
          profileToRun.name;
        const shouldAutoOpen = latestCfg?.auto_open_console_on_crash ?? true;
        setCrashToast({
          profileName: latestName,
          exitCode: ev.exit_code,
        });
        if (shouldAutoOpen) {
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
        line: `[Vexel] Juego iniciado (PID ${result.pid}) · ${
          result.downloaded_files > 0
            ? `${result.downloaded_files} archivos descargados`
            : "todos los archivos listos"
        }`,
        is_stderr: false,
        timestamp_ms: Date.now(),
      });
    } catch (err) {
      const parsed = extractIpcError(err);
      if (parsed.code === "JAVA_NOT_FOUND" && parsed.required_major) {
        setMissingJavaMajor(parsed.required_major);
      } else {
        setBannerError(
          formatFriendlyError(err, "No se pudo abrir Minecraft."),
        );
      }
    } finally {
      setLaunchingProfileId(null);
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
      setSummaryRefreshKey((k) => k + 1);
    } catch (err) {
      setBannerError(
        formatFriendlyError(err, "No se pudo detener Minecraft."),
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
      const msg = formatFriendlyError(
        err,
        `No se pudo descargar Java ${major}.`,
      );
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
      phase: "Descargando Java...",
      completed: 0,
      total: 100,
      bytes_downloaded: 0,
      detail: `Conectando para descargar Java ${major}...`,
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
      setBannerError(
        formatFriendlyError(err, `No se pudo descargar Java ${major}.`),
      );
    } finally {
      setInstallingJava(false);
    }
  };

  const handleCopyReport = async () => {
    const lines = logStore
      .getSnapshot()
      .map((l) => `[${formatLocalHms(l.timestamp_ms)}] ${l.line}`)
      .join("\n");
    const report = `=== Vexel Launcher v1.0.0 — Reporte de Diagnóstico ===\n${lines || "Sin líneas de registro."}`;
    try {
      await navigator.clipboard.writeText(report);
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

  const handleGetOptimizationStack = useCallback(
    async (profileId: string) =>
      invoke<OptimizationStackInfo>("get_profile_optimization_stack", {
        profileId,
      }),
    [],
  );

  const handleImportMrpack = useCallback(
    async (
      bytes: number[],
      onProgressCb: (ev: LaunchProgressEvent) => void,
    ) => {
      const onProgress = new Channel<LaunchProgressEvent>();
      onProgress.onmessage = (ev) => onProgressCb(ev);
      try {
        setBannerError(null);
        const res = await invoke<MrpackImportResult>("import_mrpack_bytes", {
          bytes,
          onProgress,
        });
        const refreshed = await invoke<BootstrapState>("get_bootstrap_state");
        setBootstrap(refreshed);
        setSelectedProfileId(res.profile.id);
      } catch (err) {
        const msg = formatFriendlyError(
          err,
          "No se pudo importar el archivo .mrpack.",
        );
        setBannerError(msg);
        throw new Error(msg);
      }
    },
    [],
  );

  const handleExportMrpack = useCallback(
    async (profileId: string, includeConfig: boolean) => {
      try {
        setBannerError(null);
        return await invoke<MrpackExportResult>("export_profile_mrpack", {
          profileId,
          includeConfig,
        });
      } catch (err) {
        const msg = formatFriendlyError(
          err,
          "No se pudo exportar la instancia a .mrpack.",
        );
        setBannerError(msg);
        throw new Error(msg);
      }
    },
    [],
  );

  const handleGetGlobalGameOptions = useCallback(
    async () => invoke<GlobalGameOptions>("get_global_game_options"),
    [],
  );

  const handleSaveGlobalGameOptions = useCallback(
    async (payload: SaveGlobalGameOptionsPayload) =>
      invoke<GlobalGameOptions>("save_global_game_options", { payload }),
    [],
  );

  const handleImportGlobalOptionsFromInstance = useCallback(
    async (profileId: string) =>
      invoke<GlobalGameOptions>("import_global_options_from_instance", {
        profileId,
      }),
    [],
  );

  const handleApplyGlobalOptionsToInstance = useCallback(
    async (profileId: string) =>
      invoke<ApplyGlobalOptionsResult>("apply_global_options_to_instance", {
        profileId,
      }),
    [],
  );

  const handleApplyGlobalOptionsToAllInstances = useCallback(
    async () =>
      invoke<ApplyGlobalOptionsResult>("apply_global_options_to_all_instances"),
    [],
  );

  const handleOpenReleaseUrl = useCallback(async (url: string) => {
    try {
      await invoke("open_external_url", { url });
    } catch {
      // Non-fatal
    }
  }, []);

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
    async (
      profileId: string,
      kind: ContentKind,
      sourcePath: string,
      autoClassify = false,
    ) =>
      invoke<ContentItem>("import_profile_content", {
        profileId,
        kind,
        sourcePath,
        autoClassify,
      }),
    [],
  );

  const handleImportContentBytes = useCallback(
    async (
      profileId: string,
      kind: ContentKind,
      fileName: string,
      bytes: number[],
      autoClassify = false,
    ) =>
      invoke<ContentItem>("import_profile_content_bytes", {
        profileId,
        kind,
        fileName,
        bytes,
        autoClassify,
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

  const handleReoptimizeInstance = useCallback(
    async (profileId: string) =>
      invoke<ReoptimizeResult>("reoptimize_instance_configs", { profileId }),
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
    <div className="h-screen w-screen overflow-hidden bg-[#07090D] text-slate-100 flex flex-col border border-white/[0.06]">
      {/* 36px Frameless Top Titlebar with Quick Search (Ctrl+K) */}
      <header
        data-tauri-drag-region
        className="h-9 shrink-0 bg-[#07090D] border-b border-white/[0.06] px-3 flex items-center justify-between gap-4"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 pl-0.5">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="shrink-0 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.45)]"
          >
            {/* Left luminous voxel arm + top cap */}
            <polygon
              points="1.6,4.2 3.4,2.8 5.4,4.2 3.6,5.6"
              fill="#ffffff"
              fillOpacity="0.45"
            />
            <polygon
              points="1.6,4.2 3.4,2.8 5.4,4.2 3.6,5.6"
              fill="var(--accent-primary)"
              fillOpacity="0.85"
            />
            <polygon
              points="1.6,4.2 3.6,5.6 8,12.2 8,14.2"
              fill="var(--accent-primary)"
            />
            <polygon
              points="3.6,5.6 5.4,4.2 8,8.8 8,12.2"
              fill="var(--accent-primary)"
              fillOpacity="0.82"
            />
            {/* Right shadowed voxel arm + top cap */}
            <polygon
              points="10.6,4.2 12.6,2.8 14.4,4.2 12.4,5.6"
              fill="var(--accent-primary)"
              fillOpacity="0.92"
            />
            <polygon
              points="10.6,4.2 12.4,5.6 8,12.2 8,8.8"
              fill="var(--accent-primary)"
              fillOpacity="0.58"
            />
            <polygon
              points="12.4,5.6 14.4,4.2 8,14.2 8,12.2"
              fill="var(--accent-primary)"
              fillOpacity="0.38"
            />
          </svg>
          <span
            data-tauri-drag-region
            className="text-[13px] font-semibold tracking-tight text-slate-100"
          >
            Vexel Launcher
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setQuickQuery("");
            setQuickSearchOpen(true);
          }}
          className="h-6 w-72 max-w-[40vw] rounded-md bg-[#121722]/90 hover:bg-[#171D2B] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] px-2.5 flex items-center justify-between text-[11.5px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <Search className="h-3 w-3 text-slate-500" />
            Buscar instancias...
          </span>
          <kbd className="rounded bg-white/[0.05] px-1.5 py-[1px] font-mono text-[10px] text-slate-400">
            Ctrl+K
          </kbd>
        </button>

        <div className="flex items-center gap-1.5">
          {updateInfo?.update_available && !updateDismissed && (
            <div className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] border border-[var(--accent-border)] pl-2.5 pr-1 py-0.5 text-[11px] font-medium text-[var(--accent-primary)]">
              <button
                type="button"
                onClick={() => void handleOpenReleaseUrl(updateInfo.release_url)}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <span>Nueva v{updateInfo.latest_version}</span>
                <ArrowUpRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Ocultar aviso de actualización"
                onClick={() => setUpdateDismissed(true)}
                className="p-0.5 rounded-full hover:bg-white/[0.08]"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleWindowMinimize}
            title="Minimizar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleWindowToggleMaximize}
            title="Maximizar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <Square className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            onClick={handleWindowClose}
            title="Cerrar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      {!bootstrap || !selectedProfile ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <p className="text-xs text-slate-400">
            {bannerError ?? "Iniciando Vexel Launcher..."}
          </p>
        </main>
      ) : (
        <div className="relative flex-1 flex min-h-0">
          <SidebarProfiles
            profiles={bootstrap.config.profiles}
            selectedProfileId={selectedProfile.id}
            runningProfileIds={runningProfiles}
            activeView={activeView}
            hardware={bootstrap.hardware}
            mcVersions={mcVersions}
            loadingVersions={loadingVersions}
            onSelectProfile={setSelectedProfileId}
            onSelectView={(v) => {
              if (v === "performance") setSettingsSection("instance");
              setActiveView(v);
            }}
            onPlayProfile={(id) => handlePlayProfile(id)}
            onStopProfile={(id) => handleStopProfile(id)}
            onOpenFolder={handleOpenFolder}
            onDuplicateProfile={handleDuplicateProfile}
            onSetDefault={handleSetDefault}
            onSaveProfile={handleSaveProfile}
            onDeleteProfile={handleDeleteProfile}
            onImportMrpack={handleImportMrpack}
            onExportMrpack={async (pid, includeCfg) => {
              await handleExportMrpack(pid, includeCfg);
            }}
          />

          <div className="relative flex-1 flex flex-col min-w-0 min-h-0">
            {bannerError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-lg rounded-lg bg-[#121722] border border-rose-500/35 px-4 py-2.5 text-xs text-rose-200 flex items-center gap-3 shadow-2xl">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span>{bannerError}</span>
                <button
                  type="button"
                  onClick={() => setBannerError(null)}
                  className="text-rose-400 hover:text-white shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Smart Crash Toast */}
            {crashToast && (
              <div className="absolute top-4 right-4 z-40 w-80 rounded-xl forge-card border-rose-500/35 p-4 shadow-2xl space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[13px] font-semibold text-white">
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

                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setConsoleOpen(true);
                      setCrashToast(null);
                    }}
                    className="flex-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] py-1.5 text-xs font-medium text-white transition-colors"
                  >
                    Ver consola
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyReport()}
                    className="flex-1 rounded-lg bg-[var(--accent-soft)] hover:brightness-110 py-1.5 text-xs font-medium text-[var(--accent-primary)] transition-all"
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
                  launching={launchingProfileId === selectedProfile.id}
                  isRunning={Boolean(runningProfiles[selectedProfile.id])}
                  isAnyRunning={isAnyInstanceRunning}
                  summaryRefreshKey={summaryRefreshKey}
                  progress={
                    launchingProfileId === selectedProfile.id || installingJava
                      ? progress
                      : null
                  }
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
                  onUpdateProfile={handleSaveProfile}
                  onListContent={handleListContent}
                  onGetOptimizationStack={handleGetOptimizationStack}
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
                  isProfileRunning={Boolean(
                    runningProfiles[selectedProfile.id],
                  )}
                  profilesCount={bootstrap.config.profiles.length}
                  mcVersions={mcVersions}
                  loadingVersions={loadingVersions}
                  dataRoot={bootstrap.data_root}
                  initialSection={settingsSection}
                  onUpdateProfile={handleSaveProfile}
                  onDuplicateProfile={handleDuplicateProfile}
                  onDeleteProfile={handleDeleteProfile}
                  onSaveGlobalSettings={handleSaveGlobalSettings}
                  onUploadSkinBytes={handleUploadSkinBytes}
                  onSetSkinModel={handleSetSkinModel}
                  onOpenConsole={() => setConsoleOpen(true)}
                  onOpenDataRoot={handleOpenDataRoot}
                  onListInstalledJavas={handleListInstalledJavas}
                  onInstallJavaMajor={handleInstallJavaMajorOnly}
                  onGetStorageBreakdown={handleGetStorageBreakdown}
                  onRevalidateCache={handleRevalidateCache}
                  onCleanOldLogs={handleCleanOldLogs}
                  onGetLaunchCommandPreview={handleGetLaunchCommandPreview}
                  onGetLiveMemoryTelemetry={handleGetLiveMemoryTelemetry}
                  onReoptimizeInstance={handleReoptimizeInstance}
                  onExportMrpack={handleExportMrpack}
                  onGetGlobalGameOptions={handleGetGlobalGameOptions}
                  onSaveGlobalGameOptions={handleSaveGlobalGameOptions}
                  onImportGlobalOptionsFromInstance={
                    handleImportGlobalOptionsFromInstance
                  }
                  onApplyGlobalOptionsToInstance={
                    handleApplyGlobalOptionsToInstance
                  }
                  onApplyGlobalOptionsToAllInstances={
                    handleApplyGlobalOptionsToAllInstances
                  }
                />
              )}
            </div>

            {/* Slide-Up Console Drawer (Ctrl+L or Advanced Settings / Crash Toast) */}
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
            className="w-full max-w-md rounded-xl forge-card overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2.5">
              <Search className="h-4 w-4 text-[var(--accent-primary)]" />
              <input
                type="text"
                autoFocus
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder="Buscar instancia por nombre o versión..."
                className="flex-1 bg-transparent text-[13px] text-white placeholder:text-slate-500 focus:outline-none"
              />
              <kbd className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                ESC
              </kbd>
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
                  className="w-full rounded-lg px-3 py-2 flex items-center justify-between text-left hover:bg-white/[0.05] text-[13px] transition-colors"
                >
                  <span className="text-slate-100 font-medium">{p.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">
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
