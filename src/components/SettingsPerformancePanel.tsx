import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  Coffee,
  Copy,
  Download,
  FolderOpen,
  Gauge,
  HardDrive,
  Palette,
  RefreshCw,
  Shirt,
  Trash2,
  Upload,
} from "lucide-react";
import { SkinViewer3D } from "./SkinViewer3D";
import { ACCENT_OPTIONS } from "../theme/accents";
import type {
  GcPreset,
  GlobalSettingsPayload,
  HardwareInfo,
  InstalledJavaRuntime,
  JvmTuningOutput,
  LaunchBehavior,
  LauncherConfig,
  LiveMemoryTelemetry,
  LogCleanupResult,
  ModLoaderKind,
  ProcessPriority,
  Profile,
  StorageBreakdown,
} from "../types/launcher";

export type SettingsSection =
  | "instance"
  | "performance"
  | "storage"
  | "skin"
  | "appearance";

interface SettingsPerformancePanelProps {
  profile: Profile;
  config: LauncherConfig;
  hardware: HardwareInfo;
  jvmTuning: JvmTuningOutput | null;
  skinDataUrl: string | null;
  isAnyRunning: boolean;
  dataRoot: string;
  initialSection?: SettingsSection;
  onUpdateProfile: (updated: Profile) => Promise<void>;
  onSaveGlobalSettings: (payload: GlobalSettingsPayload) => Promise<void>;
  onUploadSkinBytes: (bytes: number[]) => Promise<void>;
  onSetSkinModel: (model: "classic" | "slim") => Promise<void>;
  onOpenDataRoot: () => Promise<void>;
  onListInstalledJavas: () => Promise<InstalledJavaRuntime[]>;
  onInstallJavaMajor: (major: number) => Promise<void>;
  onGetStorageBreakdown: () => Promise<StorageBreakdown>;
  onRevalidateCache: () => Promise<void>;
  onCleanOldLogs: () => Promise<LogCleanupResult>;
  onGetLaunchCommandPreview: (profileId: string) => Promise<string>;
  onGetLiveMemoryTelemetry: () => Promise<LiveMemoryTelemetry>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? "bg-[var(--accent-soft)] border-[var(--accent-border)]"
          : "bg-[#07090D] border-white/[0.12]"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
          checked
            ? "translate-x-4 bg-[var(--accent-primary)]"
            : "translate-x-0.5 bg-slate-500"
        }`}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-slate-100">{title}</div>
        {description && (
          <p className="mt-0.5 text-[12px] text-slate-400 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0 sm:max-w-[340px] w-full sm:w-auto flex items-center sm:justify-end">
        {children}
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-white/[0.08] bg-[#07090D] px-3 py-1.5 text-[13px] text-white placeholder:text-slate-600 focus:border-[var(--accent-primary)] focus:outline-none transition-colors";

export function SettingsPerformancePanel({
  profile,
  config,
  hardware,
  jvmTuning,
  skinDataUrl,
  isAnyRunning,
  dataRoot,
  initialSection = "instance",
  onUpdateProfile,
  onSaveGlobalSettings,
  onUploadSkinBytes,
  onSetSkinModel,
  onOpenDataRoot,
  onListInstalledJavas,
  onInstallJavaMajor,
  onGetStorageBreakdown,
  onRevalidateCache,
  onCleanOldLogs,
  onGetLaunchCommandPreview,
  onGetLiveMemoryTelemetry,
}: SettingsPerformancePanelProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [expertOpen, setExpertOpen] = useState(false);

  const [nameDraft, setNameDraft] = useState(profile.name);
  const [versionDraft, setVersionDraft] = useState(profile.mc_version);
  const [ramDraft, setRamDraft] = useState(profile.ram_mb);
  const [serverDraft, setServerDraft] = useState(profile.server_address ?? "");
  const [customJvmDraft, setCustomJvmDraft] = useState(
    profile.custom_jvm_args ?? "",
  );
  const [customJavaDraft, setCustomJavaDraft] = useState(
    profile.custom_java_path ?? "",
  );
  const [widthDraft, setWidthDraft] = useState(
    profile.window_width ? String(profile.window_width) : "1280",
  );
  const [heightDraft, setHeightDraft] = useState(
    profile.window_height ? String(profile.window_height) : "720",
  );

  const [liveTelemetry, setLiveTelemetry] =
    useState<LiveMemoryTelemetry | null>(null);
  const [installedJavas, setInstalledJavas] = useState<InstalledJavaRuntime[]>(
    [],
  );
  const [installingMajor, setInstallingMajor] = useState<number | null>(null);
  const [jdkError, setJdkError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageBreakdown | null>(null);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [uploadingSkin, setUploadingSkin] = useState(false);
  const [skinError, setSkinError] = useState<string | null>(null);

  const serverDebounceRef = useRef<number | null>(null);
  const skinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (serverDebounceRef.current !== null) {
      window.clearTimeout(serverDebounceRef.current);
      serverDebounceRef.current = null;
    }
    setNameDraft(profile.name);
    setVersionDraft(profile.mc_version);
    setRamDraft(profile.ram_mb);
    setServerDraft(profile.server_address ?? "");
    setCustomJvmDraft(profile.custom_jvm_args ?? "");
    setCustomJavaDraft(profile.custom_java_path ?? "");
    setWidthDraft(profile.window_width ? String(profile.window_width) : "1280");
    setHeightDraft(
      profile.window_height ? String(profile.window_height) : "720",
    );
  }, [profile]);

  useEffect(() => {
    return () => {
      if (serverDebounceRef.current !== null) {
        window.clearTimeout(serverDebounceRef.current);
        serverDebounceRef.current = null;
      }
    };
  }, []);

  const refreshJavas = useCallback(async () => {
    try {
      const list = await onListInstalledJavas();
      setInstalledJavas(list);
    } catch {
      // Non-fatal
    }
  }, [onListInstalledJavas]);

  const refreshStorage = useCallback(async () => {
    try {
      const data = await onGetStorageBreakdown();
      setStorage(data);
    } catch {
      // Non-fatal
    }
  }, [onGetStorageBreakdown]);

  useEffect(() => {
    if (section === "performance") void refreshJavas();
    if (section === "storage") void refreshStorage();
  }, [section, refreshJavas, refreshStorage]);

  // Live memory telemetry polling every 2500ms while Performance tab is active & window visible
  useEffect(() => {
    if (section !== "performance") return;
    let cancelled = false;
    let timerId: number | null = null;

    const sample = async () => {
      if (cancelled || document.hidden) return;
      try {
        const snap = await onGetLiveMemoryTelemetry();
        if (!cancelled) setLiveTelemetry(snap);
      } catch {
        // Fallback to static bootstrap snapshot
      }
    };

    const startPolling = () => {
      if (timerId !== null) window.clearInterval(timerId);
      void sample();
      timerId = window.setInterval(() => void sample(), 2500);
    };

    const stopPolling = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    if (!document.hidden) {
      startPolling();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [section, onGetLiveMemoryTelemetry]);

  const saveGlobal = (patch: Partial<GlobalSettingsPayload>) => {
    const payload: GlobalSettingsPayload = {
      offline_username: patch.offline_username ?? config.offline_username,
      process_priority: patch.process_priority ?? config.process_priority,
      close_on_launch: patch.close_on_launch ?? config.close_on_launch,
      apply_skin_ingame: patch.apply_skin_ingame ?? config.apply_skin_ingame,
      accent_color: patch.accent_color ?? config.accent_color,
      launch_behavior: patch.launch_behavior ?? config.launch_behavior,
      auto_open_console_on_crash:
        patch.auto_open_console_on_crash ?? config.auto_open_console_on_crash,
      auto_tune_mod_configs:
        patch.auto_tune_mod_configs ?? config.auto_tune_mod_configs,
    };
    return onSaveGlobalSettings(payload).catch(() => {
      // Error surfaced via global banner
    });
  };

  const commitServer = (val: string) => {
    const normalized = val.trim() ? val.trim() : null;
    if (normalized !== profile.server_address) {
      void onUpdateProfile({ ...profile, server_address: normalized });
    }
  };

  const handleServerChange = (val: string) => {
    setServerDraft(val);
    if (serverDebounceRef.current !== null) {
      window.clearTimeout(serverDebounceRef.current);
    }
    serverDebounceRef.current = window.setTimeout(() => commitServer(val), 400);
  };

  const applyResolutionPreset = (
    w: number | null,
    h: number | null,
    fullscreen: boolean,
  ) => {
    if (w) setWidthDraft(String(w));
    if (h) setHeightDraft(String(h));
    void onUpdateProfile({
      ...profile,
      window_width: w,
      window_height: h,
      fullscreen,
    });
  };

  const handleCopyLaunchCmd = async () => {
    try {
      const cmd = await onGetLaunchCommandPreview(profile.id);
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleSkinFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingSkin(true);
    setSkinError(null);
    try {
      const buffer = await file.arrayBuffer();
      await onUploadSkinBytes(Array.from(new Uint8Array(buffer)));
    } catch (err) {
      setSkinError(
        err instanceof Error ? err.message : "No se pudo cargar la skin PNG",
      );
    } finally {
      setUploadingSkin(false);
      if (skinInputRef.current) skinInputRef.current.value = "";
    }
  };

  const recommendedMb =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;
  const totalMb = Math.max(
    liveTelemetry?.total_ram_mb ?? hardware.total_ram_mb,
    4096,
  );
  const systemUsedMb = liveTelemetry
    ? liveTelemetry.system_used_mb
    : Math.max(1024, totalMb - hardware.available_ram_mb);
  const gameDisplayMb =
    liveTelemetry && liveTelemetry.game_running
      ? liveTelemetry.game_rss_mb
      : ramDraft;
  const freeMb = Math.max(0, totalMb - systemUsedMb - gameDisplayMb);
  const sysPct = Math.min(100, (systemUsedMb / totalMb) * 100);
  const mcPct = Math.min(100 - sysPct, (gameDisplayMb / totalMb) * 100);
  const freePct = Math.max(0, 100 - sysPct - mcPct);

  const overSafeThreshold = ramDraft > hardware.max_safe_ram_mb;
  const sliderMin = 1024;
  const sliderMax = Math.max(hardware.max_safe_ram_mb, totalMb - 2048);
  const sliderSpan = Math.max(1024, sliderMax - sliderMin);
  const sliderFillPct = Math.min(
    100,
    Math.max(0, ((ramDraft - sliderMin) / sliderSpan) * 100),
  );
  const recommendedTickPct = Math.min(
    100,
    Math.max(0, ((recommendedMb - sliderMin) / sliderSpan) * 100),
  );
  const clampedOptLabelPct = Math.min(88, Math.max(12, recommendedTickPct));
  const safeBarPct = Math.min(100, (hardware.max_safe_ram_mb / totalMb) * 100);

  const lightRam = Math.max(2048, Math.min(3072, hardware.max_safe_ram_mb));
  const balancedRam = recommendedMb;
  const maxFpsRam = hardware.max_safe_ram_mb;

  const navItems: {
    id: SettingsSection;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: "instance", label: "Instancia", icon: <Box className="h-3.5 w-3.5" /> },
    {
      id: "performance",
      label: "Rendimiento y Java",
      icon: <Gauge className="h-3.5 w-3.5" />,
    },
    {
      id: "storage",
      label: "Almacenamiento",
      icon: <HardDrive className="h-3.5 w-3.5" />,
    },
    {
      id: "skin",
      label: "Skin y Cuenta",
      icon: <Shirt className="h-3.5 w-3.5" />,
    },
    {
      id: "appearance",
      label: "Apariencia",
      icon: <Palette className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="h-full w-full flex flex-col bg-[#07090D] overflow-hidden">
      {/* Clean Horizontal Top Sub-Navigation */}
      <header className="shrink-0 border-b border-white/[0.06] bg-[#0D1118] px-6 py-3">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight text-white">
              Ajustes y Rendimiento
            </h1>
            <p className="text-[11px] font-mono text-slate-500">
              {profile.name} · MC {profile.mc_version}
            </p>
          </div>

          <nav className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-[#07090D] border border-white/[0.06] p-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  section === item.id
                    ? "bg-[#121722] text-[var(--accent-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Settings Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 1. INSTANCIA */}
          {section === "instance" && (
            <section className="space-y-3">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Instancia ·{" "}
                  <span className="font-mono text-slate-500">{profile.id}</span>
                </h2>
              </div>

              <div className="rounded-xl forge-panel divide-y divide-white/[0.05]">
                <SettingRow
                  title="Nombre del perfil"
                  description="Identificador visible en la barra lateral y la portada."
                >
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => {
                      if (nameDraft.trim() && nameDraft.trim() !== profile.name) {
                        void onUpdateProfile({
                          ...profile,
                          name: nameDraft.trim(),
                        });
                      }
                    }}
                    className={`${INPUT_CLASS} sm:w-72`}
                  />
                </SettingRow>

                <SettingRow
                  title="Versión de Minecraft y Loader"
                  description="Selecciona la versión exacta del juego y el motor de mods."
                >
                  <div className="grid grid-cols-2 gap-2 w-full sm:w-72">
                    <input
                      type="text"
                      value={versionDraft}
                      onChange={(e) => setVersionDraft(e.target.value)}
                      onBlur={() => {
                        if (
                          versionDraft.trim() &&
                          versionDraft.trim() !== profile.mc_version
                        ) {
                          void onUpdateProfile({
                            ...profile,
                            mc_version: versionDraft.trim(),
                          });
                        }
                      }}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                    <select
                      value={profile.loader}
                      onChange={(e) =>
                        void onUpdateProfile({
                          ...profile,
                          loader: e.target.value as ModLoaderKind,
                        })
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="vanilla">Vanilla</option>
                      <option value="fabric">Fabric</option>
                      <option value="forge" disabled>
                        Forge (Próx.)
                      </option>
                      <option value="neo_forge" disabled>
                        NeoForge (Próx.)
                      </option>
                    </select>
                  </div>
                </SettingRow>

                <SettingRow
                  title="Resolución de ventana"
                  description="Dimensiones iniciales de GLFW al arrancar Minecraft."
                >
                  <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
                    <div className="inline-flex items-center gap-1 rounded-lg bg-[#07090D] border border-white/[0.06] p-0.5">
                      <button
                        type="button"
                        onClick={() => applyResolutionPreset(1280, 720, false)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors ${
                          !profile.fullscreen && profile.window_width === 1280
                            ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        1280×720
                      </button>
                      <button
                        type="button"
                        onClick={() => applyResolutionPreset(1920, 1080, false)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors ${
                          !profile.fullscreen && profile.window_width === 1920
                            ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        1920×1080
                      </button>
                      <button
                        type="button"
                        onClick={() => applyResolutionPreset(null, null, true)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          profile.fullscreen
                            ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Completa
                      </button>
                    </div>

                    {!profile.fullscreen && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={640}
                          max={7680}
                          value={widthDraft}
                          onChange={(e) => setWidthDraft(e.target.value)}
                          onBlur={() =>
                            void onUpdateProfile({
                              ...profile,
                              window_width: Number(widthDraft) || null,
                              fullscreen: false,
                            })
                          }
                          placeholder="Ancho"
                          className="w-24 rounded-lg border border-white/[0.08] bg-[#07090D] px-2.5 py-1 text-xs font-mono text-white text-center focus:border-[var(--accent-primary)] focus:outline-none"
                        />
                        <span className="text-xs font-mono text-slate-600">
                          ×
                        </span>
                        <input
                          type="number"
                          min={480}
                          max={4320}
                          value={heightDraft}
                          onChange={(e) => setHeightDraft(e.target.value)}
                          onBlur={() =>
                            void onUpdateProfile({
                              ...profile,
                              window_height: Number(heightDraft) || null,
                              fullscreen: false,
                            })
                          }
                          placeholder="Alto"
                          className="w-24 rounded-lg border border-white/[0.08] bg-[#07090D] px-2.5 py-1 text-xs font-mono text-white text-center focus:border-[var(--accent-primary)] focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </SettingRow>

                <SettingRow
                  title="Servidor QuickPlay"
                  description="Opcional: entra directamente a un servidor multijugador al pulsar JUGAR."
                >
                  <input
                    type="text"
                    value={serverDraft}
                    onChange={(e) => handleServerChange(e.target.value)}
                    onBlur={() => commitServer(serverDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitServer(serverDraft);
                    }}
                    placeholder="play.servidor.net:25565"
                    className={`${INPUT_CLASS} font-mono sm:w-72`}
                  />
                </SettingRow>
              </div>
            </section>
          )}

          {/* 2. RENDIMIENTO Y JAVA */}
          {section === "performance" && (
            <div className="space-y-6">
              {/* Quick Hardware Presets */}
              <div className="space-y-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Perfiles de Rendimiento ({hardware.logical_cores} hilos ·{" "}
                  {(totalMb / 1024).toFixed(0)} GB RAM)
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      id: "light",
                      title: "Ligero",
                      desc: "Aikar G1GC · Prioridad Normal",
                      badge: `${lightRam} MB`,
                      ram: lightRam,
                      gc: "aikar_g1_gc" as GcPreset,
                      prio: "normal" as ProcessPriority,
                    },
                    {
                      id: "balanced",
                      title: "Equilibrado",
                      desc: "ZGC Generacional · Above Normal",
                      badge: "Recomendado",
                      ram: balancedRam,
                      gc: "generational_zgc" as GcPreset,
                      prio: "above_normal" as ProcessPriority,
                    },
                    {
                      id: "max",
                      title: "Máximos FPS",
                      desc: "ZGC Generacional · Prioridad High",
                      badge: `${maxFpsRam} MB`,
                      ram: maxFpsRam,
                      gc: "generational_zgc" as GcPreset,
                      prio: "high" as ProcessPriority,
                    },
                  ].map((p) => {
                    const active =
                      ramDraft === p.ram && config.process_priority === p.prio;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setRamDraft(p.ram);
                          void onUpdateProfile({
                            ...profile,
                            ram_mb: p.ram,
                            gc_preset: p.gc,
                          });
                          void saveGlobal({ process_priority: p.prio });
                        }}
                        className={`rounded-xl p-3.5 text-left transition-all ${
                          active
                            ? "bg-[var(--accent-soft)] border border-[var(--accent-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                            : "forge-card-interactive"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-white">
                            {p.title}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--accent-primary)]">
                            {p.badge}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {p.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Segmented RAM Meter */}
              <section className="rounded-xl forge-panel p-5 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-medium text-slate-100">
                      Memoria RAM Asignada
                    </span>
                    {liveTelemetry?.game_running && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)] animate-pulse" />
                        RSS en vivo: {(liveTelemetry.game_rss_mb / 1024).toFixed(2)} GB
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[13px] font-mono font-semibold ${
                      overSafeThreshold
                        ? "text-[#F59E0B]"
                        : "text-[var(--accent-primary)]"
                    }`}
                  >
                    {ramDraft} MB ({(ramDraft / 1024).toFixed(1)} GB máx)
                  </span>
                </div>

                {/* Bar with Safe-Threshold Marker */}
                <div className="space-y-1.5">
                  <div className="relative h-3.5 w-full rounded-full bg-[#07090D] border border-white/[0.06] overflow-hidden flex">
                    <div
                      style={{ width: `${sysPct}%` }}
                      title={`Sistema: ${(systemUsedMb / 1024).toFixed(1)} GB`}
                      className="h-full bg-slate-600/85 border-r border-[#07090D] transition-all duration-300"
                    />
                    <div
                      style={{ width: `${mcPct}%` }}
                      title={`Minecraft: ${(gameDisplayMb / 1024).toFixed(1)} GB`}
                      className={`h-full border-r border-[#07090D] transition-all duration-300 ${
                        overSafeThreshold
                          ? "bg-[#F59E0B]"
                          : "bg-[var(--accent-primary)]"
                      }`}
                    />
                    <div style={{ width: `${freePct}%` }} className="h-full" />

                    <div
                      style={{ left: `${safeBarPct}%` }}
                      title={`Umbral seguro: ${(hardware.max_safe_ram_mb / 1024).toFixed(1)} GB`}
                      className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#F59E0B]/80"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>0 GB</span>
                    <span>{(totalMb / 2048).toFixed(0)} GB</span>
                    <span>
                      Umbral seguro {(hardware.max_safe_ram_mb / 1024).toFixed(0)} GB
                    </span>
                    <span>{(totalMb / 1024).toFixed(0)} GB total</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-500" />
                    Sistema: {(systemUsedMb / 1024).toFixed(1)} GB
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      overSafeThreshold
                        ? "text-[#F59E0B]"
                        : "text-[var(--accent-primary)]"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        overSafeThreshold
                          ? "bg-[#F59E0B]"
                          : "bg-[var(--accent-primary)]"
                      }`}
                    />
                    {liveTelemetry?.game_running
                      ? `Minecraft (real): ${(liveTelemetry.game_rss_mb / 1024).toFixed(2)} GB`
                      : `Minecraft (asignado): ${(ramDraft / 1024).toFixed(1)} GB`}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-white/[0.12]" />
                    Libre: {(freeMb / 1024).toFixed(1)} GB
                  </span>
                </div>

                <div className="relative pt-1 pb-6">
                  <input
                    type="range"
                    min={sliderMin}
                    max={sliderMax}
                    step={512}
                    value={ramDraft}
                    onChange={(e) => setRamDraft(Number(e.target.value))}
                    onPointerUp={() => {
                      if (ramDraft !== profile.ram_mb) {
                        void onUpdateProfile({ ...profile, ram_mb: ramDraft });
                      }
                    }}
                    onKeyUp={() => {
                      if (ramDraft !== profile.ram_mb) {
                        void onUpdateProfile({ ...profile, ram_mb: ramDraft });
                      }
                    }}
                    style={
                      {
                        background: `linear-gradient(to right, ${
                          overSafeThreshold ? "#f59e0b" : "var(--accent-primary)"
                        } ${sliderFillPct}%, rgba(255,255,255,0.08) ${sliderFillPct}%)`,
                        "--slider-thumb-color": overSafeThreshold
                          ? "#f59e0b"
                          : "var(--accent-primary)",
                      } as React.CSSProperties
                    }
                    className="w-full forge-slider"
                  />
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 mt-1">
                    <span>1 GB</span>
                    <span>{(sliderMax / 1024).toFixed(1)} GB</span>
                  </div>
                  <div
                    className="absolute top-6 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                    style={{ left: `${clampedOptLabelPct}%` }}
                  >
                    <span className="h-1.5 w-px bg-[var(--accent-primary)]" />
                    <span className="text-[10px] font-mono text-[var(--accent-primary)] whitespace-nowrap">
                      Óptimo: {recommendedMb} MB
                    </span>
                  </div>
                </div>

                {overSafeThreshold && (
                  <div className="rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2 flex items-center gap-2 text-xs text-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
                    Supera el umbral seguro ({hardware.max_safe_ram_mb} MB) para
                    portátiles con iGPU.
                  </div>
                )}
              </section>

              {/* Opt-in Worldgen Mod Config Tuning */}
              <div className="space-y-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Generación de Terreno y Chunks
                </h2>
                <div className="rounded-xl forge-panel divide-y divide-white/[0.05]">
                  <SettingRow
                    title="Auto-configurar mods de terreno si faltan"
                    description="Genera parámetros iniciales según tu CPU/RAM para Sodium, C2ME y Distant Horizons únicamente si el archivo de configuración no existe todavía (nunca pisa tus ajustes)."
                  >
                    <ToggleSwitch
                      checked={config.auto_tune_mod_configs}
                      onChange={(next) =>
                        void saveGlobal({ auto_tune_mod_configs: next })
                      }
                      label="Auto-configurar mods de terreno si faltan"
                    />
                  </SettingRow>
                </div>
              </div>

              {/* Java Runtime Manager */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    <Coffee className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                    Runtimes Java (Eclipse Temurin)
                  </h2>
                  <div className="flex items-center gap-1.5">
                    {[8, 17, 21].map((major) => {
                      const already = installedJavas.some(
                        (j) => j.major === major,
                      );
                      return (
                        <button
                          key={major}
                          type="button"
                          disabled={already || installingMajor !== null}
                          onClick={() => {
                            setInstallingMajor(major);
                            setJdkError(null);
                            void onInstallJavaMajor(major)
                              .then(() => refreshJavas())
                              .catch((err) =>
                                setJdkError(
                                  err instanceof Error
                                    ? err.message
                                    : `No se pudo instalar Java ${major}`,
                                ),
                              )
                              .finally(() => setInstallingMajor(null));
                          }}
                          className="rounded-md bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] disabled:opacity-45 px-2.5 py-1 text-[11px] font-mono text-slate-200 inline-flex items-center gap-1 transition-colors"
                        >
                          {already ? (
                            <Check className="h-3 w-3 text-[var(--accent-primary)]" />
                          ) : (
                            <Download className="h-3 w-3 text-[var(--accent-primary)]" />
                          )}
                          {installingMajor === major ? "..." : `JDK ${major}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {jdkError && (
                  <div className="rounded-lg bg-rose-950/50 border border-rose-500/35 px-3.5 py-2 text-xs text-rose-200">
                    {jdkError}
                  </div>
                )}

                <div className="rounded-xl forge-panel divide-y divide-white/[0.05]">
                  {installedJavas.length === 0 ? (
                    <div className="px-5 py-3.5 text-xs font-mono text-slate-500">
                      Ningún runtime descargado todavía en shared/runtimes/.
                    </div>
                  ) : (
                    installedJavas.map((rt) => (
                      <div
                        key={rt.major}
                        className="px-5 py-3 flex items-center justify-between gap-4 text-xs font-mono"
                      >
                        <div className="min-w-0 truncate">
                          <span className="text-slate-100 font-semibold">
                            Java {rt.major}
                          </span>
                          <span className="text-slate-600 mx-2">·</span>
                          <span className="text-slate-400">{rt.path}</span>
                        </div>
                        <span className="text-[var(--accent-primary)] shrink-0">
                          {formatSize(rt.size_bytes)}
                        </span>
                      </div>
                    ))
                  )}

                  <SettingRow
                    title="Ruta personalizada de javaw.exe"
                    description="Déjalo vacío para usar el runtime gestionado automáticamente por el launcher."
                  >
                    <input
                      type="text"
                      value={customJavaDraft}
                      onChange={(e) => setCustomJavaDraft(e.target.value)}
                      onBlur={() =>
                        void onUpdateProfile({
                          ...profile,
                          custom_java_path: customJavaDraft.trim() || null,
                        })
                      }
                      placeholder="C:\Program Files\...\bin\javaw.exe"
                      className={`${INPUT_CLASS} font-mono sm:w-72`}
                    />
                  </SettingRow>
                </div>
              </div>

              {/* Collapsed Advanced Accordion */}
              <section className="rounded-xl forge-panel overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpertOpen((v) => !v)}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.025] transition-colors"
                >
                  <span className="text-[13px] font-medium text-slate-200">
                    Avanzado (GC, Prioridad Win32, Flags JVM y Comando)
                  </span>
                  {expertOpen ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </button>

                {expertOpen && (
                  <div className="border-t border-white/[0.05] divide-y divide-white/[0.05]">
                    <SettingRow
                      title="Recolector de Basura (GC)"
                      description="Generational ZGC minimiza pausas en Java 21+; Aikar G1GC actúa como fallback estable."
                    >
                      <div className="inline-flex rounded-lg bg-[#07090D] border border-white/[0.06] p-0.5">
                        {(
                          [
                            { id: "generational_zgc", label: "Gen ZGC" },
                            { id: "aikar_g1_gc", label: "Aikar G1GC" },
                          ] as { id: GcPreset; label: string }[]
                        ).map((gc) => (
                          <button
                            key={gc.id}
                            type="button"
                            onClick={() =>
                              void onUpdateProfile({
                                ...profile,
                                gc_preset: gc.id,
                              })
                            }
                            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                              profile.gc_preset === gc.id
                                ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {gc.label}
                          </button>
                        ))}
                      </div>
                    </SettingRow>

                    <div className="px-5 py-3.5 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-medium text-slate-100">
                            Prioridad del proceso Win32
                          </div>
                          <p className="text-[12px] text-slate-400">
                            Clase de prioridad aplicada al proceso `javaw.exe` tras el arranque.
                          </p>
                        </div>
                        <div className="inline-flex rounded-lg bg-[#07090D] border border-white/[0.06] p-0.5 shrink-0">
                          {(
                            [
                              { id: "normal", label: "Normal" },
                              { id: "above_normal", label: "Above Normal" },
                              { id: "high", label: "High" },
                            ] as { id: ProcessPriority; label: string }[]
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                void saveGlobal({ process_priority: opt.id })
                              }
                              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                config.process_priority === opt.id
                                  ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                                  : "text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {config.process_priority === "high" && (
                        <div className="rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2 flex items-center gap-2 text-xs text-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
                          La prioridad High puede restar CPU al audio o drivers
                          de entrada en equipos con pocos núcleos. Se recomienda{" "}
                          <span className="font-mono">Above Normal</span>.
                        </div>
                      )}
                    </div>

                    <SettingRow
                      title="Argumentos JVM personalizados"
                      description="Flags adicionales añadidos al lanzamiento de esta instancia."
                    >
                      <input
                        type="text"
                        value={customJvmDraft}
                        onChange={(e) => setCustomJvmDraft(e.target.value)}
                        onBlur={() =>
                          void onUpdateProfile({
                            ...profile,
                            custom_jvm_args: customJvmDraft.trim() || null,
                          })
                        }
                        placeholder="-XX:+UnlockDiagnosticVMOptions ..."
                        className={`${INPUT_CLASS} font-mono sm:w-72`}
                      />
                    </SettingRow>

                    <div className="px-5 py-3.5 space-y-2.5">
                      {jvmTuning && (
                        <div className="selectable-logs rounded-lg bg-[#07090D] border border-white/[0.06] p-3 text-[11px] font-mono text-slate-400 break-all leading-relaxed">
                          {jvmTuning.flags.join(" ")}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCopyLaunchCmd()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
                      >
                        {copiedCmd ? (
                          <Check className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                        )}
                        {copiedCmd
                          ? "Comando copiado"
                          : "Copiar comando de lanzamiento"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* 3. ALMACENAMIENTO Y CACHÉ */}
          {section === "storage" && (
            <section className="space-y-3">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Almacenamiento y Caché Híbrida
                </h2>
                <p className="mt-0.5 text-xs font-mono text-slate-500">
                  {dataRoot}
                </p>
              </div>

              <div className="rounded-xl forge-panel overflow-hidden divide-y divide-white/[0.05]">
                <div className="p-5 space-y-4">
                  {storage ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-slate-200">
                          Uso total en disco
                        </span>
                        <span className="text-sm font-mono font-semibold text-white">
                          {formatSize(storage.total_bytes)}
                        </span>
                      </div>

                      <div className="h-3.5 w-full rounded-full bg-[#07090D] border border-white/[0.06] overflow-hidden flex">
                        {[
                          {
                            val: storage.instances_bytes,
                            color: "bg-[var(--accent-primary)]",
                          },
                          { val: storage.assets_bytes, color: "bg-slate-400" },
                          {
                            val: storage.libraries_bytes,
                            color: "bg-indigo-400/85",
                          },
                          {
                            val: storage.runtimes_bytes,
                            color: "bg-teal-400/85",
                          },
                        ].map((seg, i) => (
                          <div
                            key={i}
                            style={{
                              width: `${storage.total_bytes > 0 ? (seg.val / storage.total_bytes) * 100 : 0}%`,
                            }}
                            className={`h-full ${seg.color}`}
                          />
                        ))}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1 font-mono">
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent-primary)]">
                            <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                            Instancias
                          </div>
                          <div className="text-[13px] font-semibold text-white mt-0.5">
                            {formatSize(storage.instances_bytes)}
                          </div>
                        </div>
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                            <span className="h-2 w-2 rounded-full bg-slate-400" />
                            Assets
                          </div>
                          <div className="text-[13px] font-semibold text-white mt-0.5">
                            {formatSize(storage.assets_bytes)}
                          </div>
                        </div>
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-indigo-300">
                            <span className="h-2 w-2 rounded-full bg-indigo-400/85" />
                            Librerías
                          </div>
                          <div className="text-[13px] font-semibold text-white mt-0.5">
                            {formatSize(storage.libraries_bytes)}
                          </div>
                        </div>
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-teal-300">
                            <span className="h-2 w-2 rounded-full bg-teal-400/85" />
                            Runtimes
                          </div>
                          <div className="text-[13px] font-semibold text-white mt-0.5">
                            {formatSize(storage.runtimes_bytes)}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs font-mono text-slate-500">
                      Calculando uso de disco...
                    </p>
                  )}
                </div>

                <div className="px-5 py-3.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onRevalidateCache()
                        .then(() =>
                          setStorageFeedback(
                            "Índice integrity_index.json reiniciado; se revalidará en el próximo arranque.",
                          ),
                        )
                        .catch(() =>
                          setStorageFeedback(
                            "No se pudo reiniciar integrity_index.json.",
                          ),
                        );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                    Revalidar caché
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void onCleanOldLogs()
                        .then((res) => {
                          setStorageFeedback(
                            `Eliminados ${res.files_removed} logs antiguos (${formatSize(res.bytes_freed)} liberados).`,
                          );
                          void refreshStorage();
                        })
                        .catch(() =>
                          setStorageFeedback(
                            "No se pudieron limpiar los logs antiguos.",
                          ),
                        );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-amber-400" />
                    Limpiar logs antiguos
                  </button>

                  <button
                    type="button"
                    onClick={() => void onOpenDataRoot()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                    Abrir carpeta raíz
                  </button>
                </div>

                {storageFeedback && (
                  <div className="px-5 py-3 text-xs font-mono text-[var(--accent-primary)]">
                    {storageFeedback}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 4. SKIN Y CUENTA */}
          {section === "skin" && (
            <section className="rounded-xl forge-panel overflow-hidden grid grid-cols-1 md:grid-cols-12">
              <div className="md:col-span-5 flex flex-col items-center justify-center bg-[#07090D]/55 border-b md:border-b-0 md:border-r border-white/[0.05] py-6 px-4">
                <SkinViewer3D
                  skinUrl={skinDataUrl}
                  model={config.skin_model}
                  username={config.offline_username}
                  paused={isAnyRunning}
                  onUpdateUsername={(nick) =>
                    saveGlobal({ offline_username: nick })
                  }
                  onChangeSkinClick={() => skinInputRef.current?.click()}
                  width={230}
                  height={305}
                />
              </div>

              <div className="md:col-span-7 divide-y divide-white/[0.05] flex flex-col justify-center">
                <SettingRow
                  title="Modelo de brazos"
                  description="Elige el grosor del modelo compatible con tu textura."
                >
                  <div className="inline-flex rounded-lg bg-[#07090D] border border-white/[0.06] p-0.5">
                    <button
                      type="button"
                      onClick={() => void onSetSkinModel("classic")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        config.skin_model !== "slim"
                          ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Clásico (4px)
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSetSkinModel("slim")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        config.skin_model === "slim"
                          ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Delgado (3px)
                    </button>
                  </div>
                </SettingRow>

                <SettingRow
                  title="Aplicar skin dentro del juego"
                  description="Sincroniza _launcher_skin.zip en modo offline (solo visible localmente, sin cuenta Mojang)."
                >
                  <ToggleSwitch
                    checked={config.apply_skin_ingame}
                    onChange={(next) =>
                      void saveGlobal({ apply_skin_ingame: next })
                    }
                    label="Aplicar skin dentro del juego"
                  />
                </SettingRow>

                <div className="px-5 py-4 space-y-2.5">
                  {skinError && (
                    <div className="rounded-lg bg-rose-950/50 border border-rose-500/35 px-3 py-2 text-xs text-rose-200">
                      {skinError}
                    </div>
                  )}

                  <input
                    ref={skinInputRef}
                    type="file"
                    accept=".png,image/png"
                    onChange={(e) => void handleSkinFileSelected(e)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={uploadingSkin}
                    onClick={() => skinInputRef.current?.click()}
                    className="btn-accent w-full inline-flex items-center justify-center gap-2 rounded-lg disabled:opacity-50 py-2.5 text-[13px] font-semibold"
                  >
                    <Upload className="h-4 w-4" />
                    {uploadingSkin
                      ? "Guardando skin..."
                      : "Subir skin personalizada (.png 64×64 / 64×32 / HD)"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 5. APARIENCIA Y COMPORTAMIENTO */}
          {section === "appearance" && (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Apariencia y Comportamiento
              </h2>

              <div className="rounded-xl forge-panel divide-y divide-white/[0.05]">
                <SettingRow
                  title="Color de acento principal"
                  description="Personaliza botones principales, pedestal 3D e indicadores activos."
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ACCENT_OPTIONS.map((opt) => {
                      const active = config.accent_color === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            void saveGlobal({ accent_color: opt.id })
                          }
                          title={opt.label}
                          className={`rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                            active
                              ? "bg-[var(--accent-soft)] text-white border border-[var(--accent-border)]"
                              : "bg-[#121722] border border-white/[0.06] text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <span
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: opt.main }}
                          />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>

                <SettingRow
                  title="Al lanzar Minecraft"
                  description="Decide qué ocurre con la ventana del launcher cuando el juego arranca."
                >
                  <div className="inline-flex rounded-lg bg-[#07090D] border border-white/[0.06] p-0.5">
                    {(
                      [
                        { id: "keep_open", label: "Mantener" },
                        { id: "hide_and_restore", label: "Ocultar" },
                        { id: "close", label: "Cerrar" },
                      ] as { id: LaunchBehavior; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          void saveGlobal({
                            launch_behavior: opt.id,
                            close_on_launch: opt.id !== "keep_open",
                          })
                        }
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          config.launch_behavior === opt.id
                            ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow
                  title="Abrir consola automáticamente en crash"
                  description="Despliega el cajón de logs al instante cuando Minecraft termina con un código de error."
                >
                  <ToggleSwitch
                    checked={config.auto_open_console_on_crash}
                    onChange={(next) =>
                      void saveGlobal({ auto_open_console_on_crash: next })
                    }
                    label="Abrir consola automáticamente en crash"
                  />
                </SettingRow>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
