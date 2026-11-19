import { useCallback, useEffect, useMemo, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Cpu,
  Layers,
  LayoutDashboard,
  Minus,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import { ContentManagerPanel } from "./components/ContentManagerPanel";
import { ProfileDashboard } from "./components/ProfileDashboard";
import { SettingsPerformancePanel } from "./components/SettingsPerformancePanel";
import { SidebarProfiles } from "./components/SidebarProfiles";
import type {
  BootstrapState,
  ContentItem,
  ContentKind,
  IpcErrorPayload,
  JavaRuntimeStatus,
  JvmTuningOutput,
  LauncherConfig,
  LaunchProgressEvent,
  LaunchResult,
  LogLineEvent,
  ProcessPriority,
  Profile,
} from "./types/launcher";

type MainTab = "dashboard" | "content" | "settings";

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
  const [activeTab, setActiveTab] = useState<MainTab>("dashboard");
  const [javaStatus, setJavaStatus] = useState<JavaRuntimeStatus | null>(null);
  const [jvmTuning, setJvmTuning] = useState<JvmTuningOutput | null>(null);
  const [launching, setLaunching] = useState(false);
  const [installingJava, setInstallingJava] = useState(false);
  const [missingJavaMajor, setMissingJavaMajor] = useState<number | null>(null);
  const [javaInstallProgress, setJavaInstallProgress] =
    useState<LaunchProgressEvent | null>(null);
  const [progress, setProgress] = useState<LaunchProgressEvent | null>(null);
  const [logs, setLogs] = useState<LogLineEvent[]>([]);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const handleWindowMinimize = () => {
    try {
      void getCurrentWindow().minimize();
    } catch {
      // Running outside Tauri desktop runtime
    }
  };

  const handleWindowToggleMaximize = () => {
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {
      // Running outside Tauri desktop runtime
    }
  };

  const handleWindowClose = () => {
    try {
      void getCurrentWindow().close();
    } catch {
      // Running outside Tauri desktop runtime
    }
  };

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await invoke<BootstrapState>("get_bootstrap_state");
      setBootstrap(data);
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
          "No se pudo conectar con el backend Tauri v2. Ejecuta mediante `npm run tauri dev`.",
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
      setJavaStatus(status);
      javaMajor = status.major;
    } catch {
      setJavaStatus(null);
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

  const handleSaveGlobalSettings = async (
    offlineUsername: string,
    processPriority: ProcessPriority,
    closeOnLaunch: boolean,
  ) => {
    const nextConfig = await invoke<LauncherConfig>("save_global_settings", {
      offlineUsername,
      processPriority,
      closeOnLaunch,
    });
    updateConfigState(nextConfig);
  };

  const handlePlay = async () => {
    if (!selectedProfile) return;
    setBannerError(null);
    setLaunching(true);
    setLogs([]);

    const onProgress = new Channel<LaunchProgressEvent>();
    onProgress.onmessage = (ev) => {
      setProgress(ev);
    };

    const onLog = new Channel<LogLineEvent>();
    onLog.onmessage = (ev) => {
      setLogs((prev) => [...prev.slice(-499), ev]);
    };

    try {
      const result = await invoke<LaunchResult>("launch_profile", {
        profileId: selectedProfile.id,
        onProgress,
        onLog,
      });
      setLogs((prev) => [
        ...prev,
        {
          line: `[Launcher] Proceso activo PID ${result.pid} · Fast-Path O(1): ${result.fast_path_hits} · Descargados: ${result.downloaded_files}`,
          is_stderr: false,
          timestamp: "READY",
        },
      ]);
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
      const status = await invoke<JavaRuntimeStatus>("install_adoptium_java", {
        major,
        onProgress,
      });
      setJavaStatus(status);
      setMissingJavaMajor(null);
      setJavaInstallProgress(null);
      await handlePlay();
    } catch (err) {
      const parsed = extractIpcError(err);
      setBannerError(parsed.message ?? "Error descargando Java desde Adoptium");
    } finally {
      setInstallingJava(false);
    }
  };

  const handleListContent = useCallback(
    async (profileId: string, kind: ContentKind) =>
      invoke<ContentItem[]>("list_profile_content", { profileId, kind }),
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

  const handleImportContent = useCallback(
    async (profileId: string, kind: ContentKind, sourcePath: string) =>
      invoke<ContentItem>("import_profile_content", {
        profileId,
        kind,
        sourcePath,
      }),
    [],
  );

  const handleInjectPerformanceStack = useCallback(
    async (
      profileId: string,
      onProgressCb: (ev: LaunchProgressEvent) => void,
    ) => {
      const channel = new Channel<LaunchProgressEvent>();
      channel.onmessage = onProgressCb;
      return invoke<string[]>("inject_performance_stack", {
        profileId,
        onProgress: channel,
      });
    },
    [],
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#090b10] text-slate-100 flex flex-col border border-white/[0.07]">
      {/* Custom Frameless Titlebar */}
      <header
        data-tauri-drag-region
        className="h-11 shrink-0 bg-[#0e121a] border-b border-white/[0.07] px-3 flex items-center justify-between select-none"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2.5 pl-1"
        >
          <div className="h-6 w-6 rounded-md bg-[#10b981]/15 border border-[#10b981]/35 flex items-center justify-center text-[#10b981]">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <span
            data-tauri-drag-region
            className="text-xs font-semibold tracking-tight text-slate-100"
          >
            MC Launcher
          </span>
          <span
            data-tauri-drag-region
            className="rounded bg-white/[0.05] border border-white/[0.07] px-1.5 py-0.5 text-[10px] font-mono text-[#38bdf8]"
          >
            RUST · v0.1
          </span>
        </div>

        {bootstrap && (
          <nav className="flex items-center gap-1 rounded-lg bg-[#090b10] border border-white/[0.07] p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
                activeTab === "dashboard"
                  ? "bg-white/[0.08] text-white obsidian-inset"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <LayoutDashboard className="h-3 w-3 text-[#38bdf8]" />
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("content")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
                activeTab === "content"
                  ? "bg-white/[0.08] text-white obsidian-inset"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="h-3 w-3 text-[#38bdf8]" />
              Mods y Packs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
                activeTab === "settings"
                  ? "bg-white/[0.08] text-white obsidian-inset"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <SlidersHorizontal className="h-3 w-3 text-[#38bdf8]" />
              Rendimiento
            </button>
          </nav>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleWindowMinimize}
            title="Minimizar"
            className="h-7 w-8 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleWindowToggleMaximize}
            title="Maximizar / Restaurar"
            className="h-7 w-8 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleWindowClose}
            title="Cerrar"
            className="h-7 w-8 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-500/80 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Main Studio Workspace */}
      {!bootstrap || !selectedProfile ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl obsidian-card p-6 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#38bdf8] animate-pulse" />
              <h1 className="text-sm font-semibold text-white">
                Inicializando Motor Core
              </h1>
            </div>
            <p className="text-xs font-mono text-slate-400">
              {bannerError ?? "Leyendo hardware del sistema y perfiles..."}
            </p>
          </div>
        </main>
      ) : (
        <div className="flex-1 flex min-h-0">
          <SidebarProfiles
            profiles={bootstrap.config.profiles}
            selectedProfileId={selectedProfile.id}
            hardware={bootstrap.hardware}
            onSelectProfile={setSelectedProfileId}
            onSetDefault={handleSetDefault}
            onSaveProfile={handleSaveProfile}
            onDeleteProfile={handleDeleteProfile}
          />

          <main className="flex-1 overflow-y-auto p-5 space-y-4">
            {bannerError && (
              <div className="rounded-xl border border-rose-500/35 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between">
                <span className="font-mono">{bannerError}</span>
                <button
                  type="button"
                  onClick={() => setBannerError(null)}
                  className="text-rose-300 hover:text-white font-semibold ml-4"
                >
                  Cerrar
                </button>
              </div>
            )}

            {activeTab === "dashboard" && (
              <ProfileDashboard
                profile={selectedProfile}
                config={bootstrap.config}
                hardware={bootstrap.hardware}
                javaStatus={javaStatus}
                jvmTuning={jvmTuning}
                launching={launching}
                progress={progress}
                logs={logs}
                missingJavaMajor={missingJavaMajor}
                installingJava={installingJava}
                javaInstallProgress={javaInstallProgress}
                onPlay={handlePlay}
                onClearLogs={() => setLogs([])}
                onConfirmInstallJava={handleConfirmInstallJava}
                onDismissJavaModal={() => {
                  setMissingJavaMajor(null);
                  setJavaInstallProgress(null);
                }}
              />
            )}

            {activeTab === "content" && (
              <ContentManagerPanel
                profile={selectedProfile}
                onListContent={handleListContent}
                onToggleContent={handleToggleContent}
                onImportContent={handleImportContent}
                onInjectPerformanceStack={handleInjectPerformanceStack}
              />
            )}

            {activeTab === "settings" && (
              <SettingsPerformancePanel
                profile={selectedProfile}
                config={bootstrap.config}
                hardware={bootstrap.hardware}
                dataRoot={bootstrap.data_root}
                onUpdateProfile={handleSaveProfile}
                onSaveGlobalSettings={handleSaveGlobalSettings}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

export default App;
