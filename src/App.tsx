import { useCallback, useEffect, useMemo, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Layers, LayoutDashboard, SlidersHorizontal } from "lucide-react";
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
  const [progress, setProgress] = useState<LaunchProgressEvent | null>(null);
  const [logs, setLogs] = useState<LogLineEvent[]>([]);
  const [bannerError, setBannerError] = useState<string | null>(null);

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
          "No se pudo conectar con el backend Tauri v2. Ejecuta dentro de `cargo tauri dev`.",
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
          line: `[Launcher] Proceso activo PID ${result.pid} · Fast-Path hits: ${result.fast_path_hits} · Descargados: ${result.downloaded_files}`,
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
    const onProgress = new Channel<LaunchProgressEvent>();
    onProgress.onmessage = (ev) => {
      setProgress(ev);
    };

    try {
      const status = await invoke<JavaRuntimeStatus>("install_adoptium_java", {
        major,
        onProgress,
      });
      setJavaStatus(status);
      setMissingJavaMajor(null);
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

  if (!bootstrap || !selectedProfile) {
    return (
      <main className="min-h-screen bg-[#0b1120] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#334155] bg-[#0f172a] p-6 space-y-3">
          <h1 className="text-lg font-bold text-white">MC Launcher Rust</h1>
          <p className="text-xs text-slate-400">
            {bannerError ?? "Inicializando detección de hardware y perfiles..."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0b1120] text-slate-100 flex">
      <SidebarProfiles
        profiles={bootstrap.config.profiles}
        selectedProfileId={selectedProfile.id}
        hardware={bootstrap.hardware}
        onSelectProfile={setSelectedProfileId}
        onSetDefault={handleSetDefault}
        onSaveProfile={handleSaveProfile}
        onDeleteProfile={handleDeleteProfile}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-[#334155] bg-[#0f172a]/90 px-6 flex items-center justify-between">
          <nav className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "dashboard"
                  ? "bg-[#38bdf8]/15 text-[#38bdf8] border border-[#38bdf8]/35"
                  : "text-slate-400 hover:text-white hover:bg-[#1e293b]"
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("content")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "content"
                  ? "bg-[#38bdf8]/15 text-[#38bdf8] border border-[#38bdf8]/35"
                  : "text-slate-400 hover:text-white hover:bg-[#1e293b]"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Mods y Paquetes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "settings"
                  ? "bg-[#38bdf8]/15 text-[#38bdf8] border border-[#38bdf8]/35"
                  : "text-slate-400 hover:text-white hover:bg-[#1e293b]"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Ajustes y Rendimiento
            </button>
          </nav>

          <div className="text-[11px] font-mono text-slate-400">
            Vanilla óptimo:{" "}
            <span className="text-slate-200">
              {bootstrap.hardware.recommended_vanilla_mb} MB
            </span>{" "}
            · Modpack óptimo:{" "}
            <span className="text-[#10b981]">
              {bootstrap.hardware.recommended_modded_mb} MB
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-4">
          {bannerError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200 flex items-center justify-between">
              <span>{bannerError}</span>
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
              onPlay={handlePlay}
              onConfirmInstallJava={handleConfirmInstallJava}
              onDismissJavaModal={() => setMissingJavaMajor(null)}
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
    </div>
  );
}

export default App;
