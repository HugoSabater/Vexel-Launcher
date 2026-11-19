import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  Check,
  Copy,
  Layers,
  Minus,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
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
  InstanceExitEvent,
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

type MainView = "play" | "content" | "settings";

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

function classifyLogLine(entry: LogLineEvent): string {
  const upper = entry.line.toUpperCase();
  if (entry.is_stderr || upper.includes("[ERROR]") || upper.includes("FATAL")) {
    return "text-rose-300";
  }
  if (upper.includes("[WARN]") || upper.includes("WARNING")) {
    return "text-amber-300";
  }
  if (
    entry.line.startsWith("[Win32 Tuning]") ||
    entry.line.startsWith("[JVM Optimizer]") ||
    entry.line.startsWith("[Launcher]")
  ) {
    return "text-[#38BDF8]";
  }
  return "text-slate-300";
}

function PixelMinecraftAvatar({ username }: { username: string }) {
  const hash = Array.from(username || "Player").reduce(
    (acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360,
    17,
  );
  const skinBase = `hsl(${(hash + 25) % 45 + 18}, 42%, 56%)`;
  const hairColor = `hsl(${hash}, 38%, 22%)`;
  const eyeColor = `hsl(${(hash + 180) % 360}, 65%, 52%)`;

  return (
    <svg
      viewBox="0 0 8 8"
      className="h-7 w-7 rounded-md shrink-0 border border-white/[0.08]"
      style={{ imageRendering: "pixelated" }}
    >
      <rect width="8" height="8" fill={skinBase} />
      <rect x="0" y="0" width="8" height="2" fill={hairColor} />
      <rect x="0" y="2" width="1" height="1" fill={hairColor} />
      <rect x="7" y="2" width="1" height="1" fill={hairColor} />
      <rect x="1" y="4" width="1" height="1" fill="#f8fafc" />
      <rect x="2" y="4" width="1" height="1" fill={eyeColor} />
      <rect x="5" y="4" width="1" height="1" fill={eyeColor} />
      <rect x="6" y="4" width="1" height="1" fill="#f8fafc" />
      <rect x="3" y="5" width="2" height="1" fill="rgba(0,0,0,0.18)" />
      <rect x="2" y="6" width="4" height="1" fill="rgba(0,0,0,0.28)" />
    </svg>
  );
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [activeView, setActiveView] = useState<MainView>("play");
  const [javaStatus, setJavaStatus] = useState<JavaRuntimeStatus | null>(null);
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
  const [logs, setLogs] = useState<LogLineEvent[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [crashToast, setCrashToast] = useState<CrashToastState | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [identityPopoverOpen, setIdentityPopoverOpen] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const consoleRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setConsoleOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (autoScroll && consoleOpen && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, autoScroll, consoleOpen]);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await invoke<BootstrapState>("get_bootstrap_state");
      setBootstrap(data);
      setDraftUsername(data.config.offline_username);
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
      setBannerError(extractIpcError(err).message ?? "No se pudo abrir carpeta");
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
    setDraftUsername(nextConfig.offline_username);
  };

  const handlePlayProfile = async (targetProfileId?: string) => {
    const profileToRun =
      (targetProfileId
        ? bootstrap?.config.profiles.find((p) => p.id === targetProfileId)
        : selectedProfile) ?? null;

    if (!profileToRun || runningProfiles[profileToRun.id]) return;

    setBannerError(null);
    setCrashToast(null);
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
      }
    };

    try {
      const result = await invoke<LaunchResult>("launch_profile", {
        profileId: profileToRun.id,
        onProgress,
        onLog,
        onExit,
      });
      setRunningProfiles((prev) => ({ ...prev, [profileToRun.id]: true }));
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
      setBannerError(extractIpcError(err).message ?? "Error al detener proceso");
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
      await handlePlayProfile();
    } catch (err) {
      const parsed = extractIpcError(err);
      setBannerError(parsed.message ?? "Error descargando Java desde Adoptium");
    } finally {
      setInstallingJava(false);
    }
  };

  const handleCopyReport = async () => {
    const report = logs.map((l) => `[${l.timestamp}] ${l.line}`).join("\n");
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
    <div className="h-screen w-screen overflow-hidden bg-[#0A0C10] text-slate-100 flex flex-col border border-white/[0.06]">
      {/* Minimal Frameless Titlebar */}
      <header
        data-tauri-drag-region
        className="h-9 shrink-0 bg-[#0A0C10] border-b border-white/[0.05] px-3 flex items-center justify-between"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 pl-1">
          <span className="h-2 w-2 rounded-sm bg-[#10B981]" />
          <span
            data-tauri-drag-region
            className="text-[11px] font-medium tracking-wide text-slate-400"
          >
            MC Launcher
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleWindowMinimize}
            title="Minimizar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#181D28]"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleWindowToggleMaximize}
            title="Maximizar"
            className="h-6 w-8 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#181D28]"
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

      {/* Main Seamless Desktop Body */}
      {!bootstrap || !selectedProfile ? (
        <main className="flex-1 flex items-center justify-center p-6">
          <p className="text-xs font-mono text-slate-400">
            {bannerError ?? "Inicializando..."}
          </p>
        </main>
      ) : (
        <div className="relative flex-1 flex min-h-0">
          {/* 56px Minimalist Left Rail */}
          <nav className="w-[56px] shrink-0 bg-[#10131A] border-r border-white/[0.05] py-3 flex flex-col items-center justify-between">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                title="Jugar"
                onClick={() => setActiveView("play")}
                className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors ${
                  activeView === "play"
                    ? "bg-[#181D28] text-[#38BDF8] border border-white/[0.06]"
                    : "text-slate-500 hover:text-slate-200 hover:bg-[#181D28]/60"
                }`}
              >
                <Play className="h-4 w-4" />
              </button>

              <button
                type="button"
                title="Mods y Paquetes"
                onClick={() => setActiveView("content")}
                className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors ${
                  activeView === "content"
                    ? "bg-[#181D28] text-[#38BDF8] border border-white/[0.06]"
                    : "text-slate-500 hover:text-slate-200 hover:bg-[#181D28]/60"
                }`}
              >
                <Layers className="h-4 w-4" />
              </button>

              <button
                type="button"
                title="Ajustes"
                onClick={() => setActiveView("settings")}
                className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors ${
                  activeView === "settings"
                    ? "bg-[#181D28] text-[#38BDF8] border border-white/[0.06]"
                    : "text-slate-500 hover:text-slate-200 hover:bg-[#181D28]/60"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>

            {/* Bottom Fixed: Player Identity Widget + Discreet Terminal Toggle */}
            <div className="relative flex flex-col items-center gap-2.5">
              <button
                type="button"
                title={`Consola de logs (Ctrl + L)`}
                onClick={() => setConsoleOpen((v) => !v)}
                className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
                  consoleOpen
                    ? "bg-[#181D28] text-[#38BDF8] border border-white/[0.06]"
                    : "text-slate-500 hover:text-slate-200 hover:bg-[#181D28]/60"
                }`}
              >
                <Terminal className="h-4 w-4" />
              </button>

              <button
                type="button"
                title={`Jugador: ${bootstrap.config.offline_username} (clic para editar)`}
                onClick={() => {
                  setDraftUsername(bootstrap.config.offline_username);
                  setIdentityPopoverOpen((v) => !v);
                }}
                className="p-1 rounded-lg hover:bg-[#181D28] transition-colors"
              >
                <PixelMinecraftAvatar
                  username={bootstrap.config.offline_username}
                />
              </button>

              {identityPopoverOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draftUsername.trim()) {
                      void handleSaveGlobalSettings(
                        draftUsername.trim(),
                        bootstrap.config.process_priority,
                        bootstrap.config.close_on_launch,
                      );
                    }
                    setIdentityPopoverOpen(false);
                  }}
                  className="absolute left-14 bottom-1 z-50 w-56 rounded-xl bg-[#181D28] border border-white/[0.08] p-3 shadow-2xl space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-300">
                      Identidad Offline
                    </span>
                    <button
                      type="button"
                      onClick={() => setIdentityPopoverOpen(false)}
                      className="text-slate-500 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={draftUsername}
                    onChange={(e) => setDraftUsername(e.target.value)}
                    className="w-full rounded-md border border-white/[0.08] bg-[#0A0C10] px-2.5 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-md bg-[#10B981] hover:bg-[#059669] py-1.5 text-[11px] font-semibold text-slate-950"
                  >
                    Guardar Nick
                  </button>
                </form>
              )}
            </div>
          </nav>

          {/* 220px Compact Profile Column */}
          <SidebarProfiles
            profiles={bootstrap.config.profiles}
            selectedProfileId={selectedProfile.id}
            runningProfileIds={runningProfiles}
            hardware={bootstrap.hardware}
            onSelectProfile={setSelectedProfileId}
            onPlayProfile={(id) => handlePlayProfile(id)}
            onStopProfile={(id) => handleStopProfile(id)}
            onOpenFolder={handleOpenFolder}
            onDuplicateProfile={handleDuplicateProfile}
            onSetDefault={handleSetDefault}
            onSaveProfile={handleSaveProfile}
            onDeleteProfile={handleDeleteProfile}
          />

          {/* Main Workspace + Slide-Up Log Drawer */}
          <div className="relative flex-1 flex flex-col min-w-0 min-h-0">
            {bannerError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 rounded-lg bg-[#181D28] border border-rose-500/40 px-4 py-2 text-xs font-mono text-rose-200 flex items-center gap-3 shadow-xl">
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

            {/* Smart Crash Toast (Top-Right) */}
            {crashToast && (
              <div className="absolute top-4 right-4 z-40 w-80 rounded-xl bg-[#181D28] border border-rose-500/35 p-3.5 shadow-2xl space-y-2.5">
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
                    className="flex-1 rounded-lg bg-[#10131A] hover:bg-white/[0.06] border border-white/[0.08] py-1.5 text-[11px] font-medium text-white"
                  >
                    Ver consola
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyReport()}
                    className="flex-1 rounded-lg bg-[#10131A] hover:bg-white/[0.06] border border-white/[0.08] py-1.5 text-[11px] font-medium text-[#38BDF8]"
                  >
                    {copiedLogs ? "Copiado" : "Copiar reporte"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0">
              {activeView === "play" && (
                <ProfileDashboard
                  profile={selectedProfile}
                  javaStatus={javaStatus}
                  jvmTuning={jvmTuning}
                  launching={launching}
                  isRunning={Boolean(runningProfiles[selectedProfile.id])}
                  progress={progress}
                  missingJavaMajor={missingJavaMajor}
                  installingJava={installingJava}
                  javaInstallProgress={javaInstallProgress}
                  onPlay={() => handlePlayProfile()}
                  onStop={() => handleStopProfile()}
                  onOpenSettings={() => setActiveView("settings")}
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
                  onToggleContent={handleToggleContent}
                  onImportContent={handleImportContent}
                  onInjectPerformanceStack={handleInjectPerformanceStack}
                />
              )}

              {activeView === "settings" && (
                <SettingsPerformancePanel
                  profile={selectedProfile}
                  config={bootstrap.config}
                  hardware={bootstrap.hardware}
                  dataRoot={bootstrap.data_root}
                  onUpdateProfile={handleSaveProfile}
                  onSaveGlobalSettings={handleSaveGlobalSettings}
                />
              )}
            </div>

            {/* Slide-Up Bottom Console Drawer (Hidden by Default, Ctrl + L) */}
            {consoleOpen && (
              <section className="h-56 shrink-0 border-t border-white/[0.08] bg-[#07090D] flex flex-col">
                <div className="h-9 px-4 bg-[#10131A] border-b border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-[#38BDF8]" />
                    <span className="text-[11px] font-medium text-slate-200">
                      Consola de Ejecución
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      ({logs.length})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAutoScroll((v) => !v)}
                      className={`rounded px-2 py-0.5 text-[10px] font-mono border ${
                        autoScroll
                          ? "border-[#38BDF8]/30 text-[#38BDF8]"
                          : "border-white/[0.06] text-slate-500"
                      }`}
                    >
                      auto-scroll
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyReport()}
                      className="inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:bg-[#181D28]"
                    >
                      {copiedLogs ? (
                        <Check className="h-3 w-3 text-[#10B981]" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogs([])}
                      title="Limpiar"
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#181D28]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsoleOpen(false)}
                      title="Ocultar (Ctrl + L)"
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#181D28]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  ref={consoleRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const atBottom =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 20;
                    if (!atBottom && autoScroll) setAutoScroll(false);
                  }}
                  className="selectable-logs flex-1 overflow-y-auto px-4 py-2.5 font-mono text-[11px] leading-relaxed space-y-0.5"
                >
                  {logs.length === 0 ? (
                    <div className="text-slate-600">
                      $ esperando salida del proceso javaw.exe...
                    </div>
                  ) : (
                    logs.map((entry, idx) => (
                      <div
                        key={`${entry.timestamp}-${idx}`}
                        className="break-all"
                      >
                        <span className="text-slate-600 mr-2">
                          {entry.timestamp}
                        </span>
                        <span className={classifyLogLine(entry)}>
                          {entry.line}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
