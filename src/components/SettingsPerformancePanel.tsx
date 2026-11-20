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
import type {
  AccentColor,
  GcPreset,
  GlobalSettingsPayload,
  HardwareInfo,
  InstalledJavaRuntime,
  JvmTuningOutput,
  LaunchBehavior,
  LauncherConfig,
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
}

const ACCENT_OPTIONS: { id: AccentColor; label: string; hex: string }[] = [
  { id: "emerald", label: "Esmeralda", hex: "#10B981" },
  { id: "cyan", label: "Cian", hex: "#38BDF8" },
  { id: "indigo", label: "Índigo", hex: "#6366F1" },
  { id: "amber", label: "Ámbar", hex: "#F59E0B" },
  { id: "crimson", label: "Carmesí", hex: "#F43F5E" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SettingsPerformancePanel({
  profile,
  config,
  hardware,
  jvmTuning,
  skinDataUrl,
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
}: SettingsPerformancePanelProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [expertOpen, setExpertOpen] = useState(false);

  // Local drafts to prevent disk writes per keystroke/pixel
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

  const [installedJavas, setInstalledJavas] = useState<InstalledJavaRuntime[]>(
    [],
  );
  const [installingMajor, setInstallingMajor] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageBreakdown | null>(null);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [uploadingSkin, setUploadingSkin] = useState(false);

  const serverDebounceRef = useRef<number | null>(null);
  const skinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
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

  const refreshJavas = useCallback(async () => {
    const list = await onListInstalledJavas();
    setInstalledJavas(list);
  }, [onListInstalledJavas]);

  const refreshStorage = useCallback(async () => {
    const data = await onGetStorageBreakdown();
    setStorage(data);
  }, [onGetStorageBreakdown]);

  useEffect(() => {
    if (section === "performance") void refreshJavas();
    if (section === "storage") void refreshStorage();
  }, [section, refreshJavas, refreshStorage]);

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
    };
    return onSaveGlobalSettings(payload);
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
    const cmd = await onGetLaunchCommandPreview(profile.id);
    await navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  const handleSkinFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingSkin(true);
    try {
      const buffer = await file.arrayBuffer();
      await onUploadSkinBytes(Array.from(new Uint8Array(buffer)));
    } finally {
      setUploadingSkin(false);
      if (skinInputRef.current) skinInputRef.current.value = "";
    }
  };

  const recommendedMb =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;
  const totalMb = Math.max(hardware.total_ram_mb, 4096);
  const systemUsedMb = Math.max(1024, totalMb - hardware.available_ram_mb);
  const freeMb = Math.max(0, totalMb - systemUsedMb - ramDraft);
  const sysPct = Math.min(100, (systemUsedMb / totalMb) * 100);
  const mcPct = Math.min(100 - sysPct, (ramDraft / totalMb) * 100);
  const freePct = Math.max(0, 100 - sysPct - mcPct);
  const overSafeThreshold = ramDraft > hardware.max_safe_ram_mb;
  const sliderMax = Math.max(hardware.max_safe_ram_mb, totalMb - 2048);
  const recommendedTickPct = Math.min(
    100,
    Math.max(
      0,
      ((recommendedMb - 1024) / Math.max(1024, sliderMax - 1024)) * 100,
    ),
  );

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
    <div className="h-full w-full flex bg-[#080A0F] overflow-hidden">
      {/* 180px Fixed Internal Settings Sidebar */}
      <aside className="w-[180px] shrink-0 border-r border-[#1E2534] bg-[#0B0E14] p-3 space-y-1">
        <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          Ajustes
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={`w-full rounded-lg px-2.5 py-2 flex items-center gap-2 text-xs font-medium transition-colors ${
              section === item.id
                ? "bg-[#171D2A] text-[#38BDF8] border border-[#1E2534]"
                : "text-slate-400 hover:text-slate-200 hover:bg-[#11151E] border border-transparent"
            }`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </aside>

      {/* Settings Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-5">
          {/* 1. INSTANCIA */}
          {section === "instance" && (
            <section className="space-y-4">
              <div>
                <h1 className="text-base font-semibold text-white">
                  Configuración de la Instancia
                </h1>
                <p className="text-xs text-slate-500">
                  Edita en caliente los metadatos, resolución y servidor directo
                  de <span className="font-mono text-slate-300">{profile.id}</span>.
                </p>
              </div>

              <div className="rounded-xl bg-[#11151E] border border-[#1E2534] divide-y divide-[#1E2534]">
                <div className="p-4 grid grid-cols-12 items-center gap-3">
                  <label className="col-span-4 text-xs text-slate-300">
                    Nombre del perfil
                  </label>
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
                    className="col-span-8 rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs text-white focus:border-[#38BDF8] focus:outline-none"
                  />
                </div>

                <div className="p-4 grid grid-cols-12 items-center gap-3">
                  <label className="col-span-4 text-xs text-slate-300">
                    Versión y Loader
                  </label>
                  <div className="col-span-8 grid grid-cols-2 gap-2">
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
                      className="rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                    />
                    <select
                      value={profile.loader}
                      onChange={(e) =>
                        void onUpdateProfile({
                          ...profile,
                          loader: e.target.value as ModLoaderKind,
                        })
                      }
                      className="rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs text-white focus:border-[#38BDF8] focus:outline-none"
                    >
                      <option value="vanilla">Vanilla</option>
                      <option value="fabric">Fabric</option>
                      <option value="forge">Forge</option>
                      <option value="neo_forge">NeoForge</option>
                    </select>
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">
                      Resolución de Ventana
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyResolutionPreset(1280, 720, false)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-mono border ${
                          !profile.fullscreen && profile.window_width === 1280
                            ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]/40"
                            : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                        }`}
                      >
                        1280×720
                      </button>
                      <button
                        type="button"
                        onClick={() => applyResolutionPreset(1920, 1080, false)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-mono border ${
                          !profile.fullscreen && profile.window_width === 1920
                            ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]/40"
                            : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                        }`}
                      >
                        1920×1080
                      </button>
                      <button
                        type="button"
                        onClick={() => applyResolutionPreset(null, null, true)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-mono border ${
                          profile.fullscreen
                            ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]/40"
                            : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                        }`}
                      >
                        Pantalla completa
                      </button>
                    </div>
                  </div>

                  {!profile.fullscreen && (
                    <div className="grid grid-cols-2 gap-2 pl-0 sm:pl-44">
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
                        className="rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                      />
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
                        className="rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 grid grid-cols-12 items-center gap-3">
                  <label className="col-span-4 text-xs text-slate-300">
                    Servidor QuickPlay
                  </label>
                  <input
                    type="text"
                    value={serverDraft}
                    onChange={(e) => handleServerChange(e.target.value)}
                    onBlur={() => commitServer(serverDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitServer(serverDraft);
                    }}
                    placeholder="play.servidor.net:25565"
                    className="col-span-8 rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                  />
                </div>
              </div>
            </section>
          )}

          {/* 2. RENDIMIENTO Y JAVA */}
          {section === "performance" && (
            <div className="space-y-4">
              {/* 3 Quick Presets */}
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  {
                    id: "light",
                    title: "Ligero",
                    badge: `${lightRam} MB`,
                    ram: lightRam,
                    gc: "aikar_g1_gc" as GcPreset,
                    prio: "normal" as ProcessPriority,
                  },
                  {
                    id: "balanced",
                    title: "Equilibrado",
                    badge: "Recomendado",
                    ram: balancedRam,
                    gc: "generational_zgc" as GcPreset,
                    prio: "above_normal" as ProcessPriority,
                  },
                  {
                    id: "max",
                    title: "Máximos FPS",
                    badge: `${maxFpsRam} MB`,
                    ram: maxFpsRam,
                    gc: "generational_zgc" as GcPreset,
                    prio: "high" as ProcessPriority,
                  },
                ].map((p) => (
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
                    className={`rounded-xl p-3.5 text-left border transition-colors ${
                      ramDraft === p.ram && config.process_priority === p.prio
                        ? "bg-[#171D2A] border-[#38BDF8]"
                        : "bg-[#11151E] border-[#1E2534] hover:border-slate-700"
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">
                      {p.title}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-[#38BDF8]">
                      {p.badge}
                    </div>
                  </button>
                ))}
              </div>

              {/* Segmented RAM Meter */}
              <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">
                    Memoria RAM Asignada
                  </span>
                  <span className="font-mono font-semibold text-[#38BDF8]">
                    {ramDraft} MB ({(ramDraft / 1024).toFixed(1)} GB)
                  </span>
                </div>

                <div className="h-3.5 w-full rounded-lg bg-[#080A0F] border border-[#1E2534] overflow-hidden flex">
                  <div
                    style={{ width: `${sysPct}%` }}
                    className="h-full bg-slate-600/70 border-r border-[#080A0F]"
                  />
                  <div
                    style={{ width: `${mcPct}%` }}
                    className={`h-full border-r border-[#080A0F] ${
                      overSafeThreshold ? "bg-[#F59E0B]" : "bg-[#38BDF8]"
                    }`}
                  />
                  <div style={{ width: `${freePct}%` }} className="h-full" />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Sistema: {(systemUsedMb / 1024).toFixed(1)} GB</span>
                  <span
                    className={
                      overSafeThreshold ? "text-[#F59E0B]" : "text-[#38BDF8]"
                    }
                  >
                    Minecraft: {(ramDraft / 1024).toFixed(1)} GB
                  </span>
                  <span>Libre: {(freeMb / 1024).toFixed(1)} GB</span>
                </div>

                <div className="relative pt-1 pb-5">
                  <input
                    type="range"
                    min={1024}
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
                    className="w-full forge-slider"
                  />
                  <div
                    className="absolute top-6 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                    style={{ left: `${recommendedTickPct}%` }}
                  >
                    <span className="h-1.5 w-px bg-[#38BDF8]" />
                    <span className="text-[10px] font-mono text-[#38BDF8] whitespace-nowrap">
                      Óptimo: {recommendedMb} MB
                    </span>
                  </div>
                </div>

                {overSafeThreshold && (
                  <div className="rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/35 px-3 py-2 flex items-center gap-2 text-[11px] text-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
                    Supera el umbral seguro ({hardware.max_safe_ram_mb} MB) para
                    portátiles con iGPU.
                  </div>
                )}
              </section>

              {/* Java Runtime Manager */}
              <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <Coffee className="h-3.5 w-3.5 text-[#38BDF8]" />
                    Gestor de Runtimes Java (Eclipse Temurin)
                  </span>
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
                            void onInstallJavaMajor(major)
                              .then(() => refreshJavas())
                              .finally(() => setInstallingMajor(null));
                          }}
                          className="rounded-md bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] disabled:opacity-45 px-2 py-1 text-[10px] font-mono text-slate-300 inline-flex items-center gap-1"
                        >
                          {already ? (
                            <Check className="h-2.5 w-2.5 text-[#10B981]" />
                          ) : (
                            <Download className="h-2.5 w-2.5 text-[#38BDF8]" />
                          )}
                          {installingMajor === major ? "..." : `JDK ${major}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {installedJavas.length === 0 ? (
                  <p className="text-[11px] font-mono text-slate-500">
                    Ningún runtime descargado todavía en shared/runtimes/.
                  </p>
                ) : (
                  <div className="divide-y divide-[#1E2534] rounded-lg bg-[#080A0F] border border-[#1E2534]">
                    {installedJavas.map((rt) => (
                      <div
                        key={rt.major}
                        className="px-3 py-2 flex items-center justify-between text-[11px] font-mono"
                      >
                        <span className="text-slate-200">
                          Java {rt.major} ·{" "}
                          <span className="text-slate-500">{rt.path}</span>
                        </span>
                        <span className="text-[#38BDF8] shrink-0 ml-2">
                          {formatSize(rt.size_bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400">
                    Ruta personalizada de javaw.exe (Opcional — deja vacío para
                    auto-gestión)
                  </label>
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
                    placeholder="C:\Program Files\Eclipse Adoptium\...\bin\javaw.exe"
                    className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                  />
                </div>
              </section>

              {/* Collapsed Advanced Accordion */}
              <section className="rounded-xl bg-[#11151E] border border-[#1E2534] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpertOpen((v) => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#171D2A]/50"
                >
                  <span className="text-xs font-semibold text-slate-200">
                    Avanzado (GC, Win32, Flags JVM y Comando)
                  </span>
                  {expertOpen ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </button>

                {expertOpen && (
                  <div className="p-4 border-t border-[#1E2534] space-y-4">
                    <div className="grid grid-cols-2 gap-2.5">
                      {(
                        [
                          { id: "generational_zgc", label: "Generational ZGC" },
                          { id: "aikar_g1_gc", label: "Aikar's G1GC" },
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
                          className={`rounded-lg py-2 px-3 text-xs font-medium border ${
                            profile.gc_preset === gc.id
                              ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]"
                              : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                          }`}
                        >
                          {gc.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#080A0F] border border-[#1E2534] p-1">
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
                          className={`rounded-md py-1.5 text-[11px] font-medium ${
                            config.process_priority === opt.id
                              ? "bg-[#171D2A] text-[#38BDF8]"
                              : "text-slate-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] text-slate-400">
                        Argumentos JVM Personalizados
                      </label>
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
                        className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-1.5 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                      />
                    </div>

                    {jvmTuning && (
                      <div className="selectable-logs rounded-lg bg-[#080A0F] border border-[#1E2534] p-2.5 text-[10px] font-mono text-slate-400 break-all">
                        {jvmTuning.flags.join(" ")}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleCopyLaunchCmd()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-3 py-1.5 text-xs text-slate-200"
                    >
                      {copiedCmd ? (
                        <Check className="h-3.5 w-3.5 text-[#10B981]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-[#38BDF8]" />
                      )}
                      {copiedCmd
                        ? "Comando copiado"
                        : "Copiar comando de lanzamiento"}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* 3. ALMACENAMIENTO Y CACHÉ */}
          {section === "storage" && (
            <section className="space-y-4">
              <div>
                <h1 className="text-base font-semibold text-white">
                  Almacenamiento y Caché Híbrida
                </h1>
                <p className="text-xs font-mono text-slate-500">{dataRoot}</p>
              </div>

              <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-4">
                {storage ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">
                        Uso total en disco
                      </span>
                      <span className="font-mono font-semibold text-white">
                        {formatSize(storage.total_bytes)}
                      </span>
                    </div>

                    <div className="h-4 w-full rounded-lg bg-[#080A0F] border border-[#1E2534] overflow-hidden flex">
                      {[
                        { val: storage.assets_bytes, color: "bg-[#38BDF8]" },
                        { val: storage.libraries_bytes, color: "bg-indigo-400" },
                        { val: storage.runtimes_bytes, color: "bg-[#10B981]" },
                        { val: storage.instances_bytes, color: "bg-amber-400" },
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

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-2.5">
                        <div className="text-[#38BDF8]">Assets</div>
                        <div className="text-white mt-0.5">
                          {formatSize(storage.assets_bytes)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-2.5">
                        <div className="text-indigo-400">Librerías</div>
                        <div className="text-white mt-0.5">
                          {formatSize(storage.libraries_bytes)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-2.5">
                        <div className="text-[#10B981]">Runtimes</div>
                        <div className="text-white mt-0.5">
                          {formatSize(storage.runtimes_bytes)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-2.5">
                        <div className="text-amber-400">Instancias</div>
                        <div className="text-white mt-0.5">
                          {formatSize(storage.instances_bytes)}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs font-mono text-slate-500">
                    Calculando uso de disco...
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1E2534]">
                  <button
                    type="button"
                    onClick={() => {
                      void onRevalidateCache().then(() =>
                        setStorageFeedback(
                          "Índice integrity_index.json reiniciado; se revalidará en el próximo arranque.",
                        ),
                      );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-3 py-1.5 text-xs text-slate-200"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-[#38BDF8]" />
                    Revalidar índice de caché
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void onCleanOldLogs().then((res) => {
                        setStorageFeedback(
                          `Eliminados ${res.files_removed} logs antiguos (${formatSize(res.bytes_freed)} liberados).`,
                        );
                        void refreshStorage();
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-3 py-1.5 text-xs text-slate-200"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-amber-400" />
                    Limpiar logs antiguos
                  </button>

                  <button
                    type="button"
                    onClick={() => void onOpenDataRoot()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-3 py-1.5 text-xs text-slate-200"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#10B981]" />
                    Abrir carpeta raíz
                  </button>
                </div>

                {storageFeedback && (
                  <p className="text-xs font-mono text-[#38BDF8]">
                    {storageFeedback}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* 4. SKIN Y CUENTA */}
          {section === "skin" && (
            <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              <div className="md:col-span-5 flex flex-col items-center justify-center rounded-xl bg-[#080A0F] border border-[#1E2534] py-4">
                <SkinViewer3D
                  skinUrl={skinDataUrl}
                  model={config.skin_model}
                  username={config.offline_username}
                  onUpdateUsername={(nick) =>
                    saveGlobal({ offline_username: nick })
                  }
                  onChangeSkinClick={() => skinInputRef.current?.click()}
                  width={220}
                  height={295}
                />
              </div>

              <div className="md:col-span-7 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Modelo de Brazos
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void onSetSkinModel("classic")}
                      className={`rounded-lg py-2 px-3 text-xs font-medium border ${
                        config.skin_model !== "slim"
                          ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]"
                          : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                      }`}
                    >
                      Clásico (4px · Steve)
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSetSkinModel("slim")}
                      className={`rounded-lg py-2 px-3 text-xs font-medium border ${
                        config.skin_model === "slim"
                          ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]"
                          : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                      }`}
                    >
                      Delgado (3px · Alex)
                    </button>
                  </div>
                </div>

                <label className="flex items-center justify-between rounded-lg bg-[#080A0F] border border-[#1E2534] px-3.5 py-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-medium text-white">
                      Aplicar skin dentro del juego
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Genera y activa automáticamente{" "}
                      <code>_launcher_skin.zip</code> en offline.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.apply_skin_ingame}
                    onChange={(e) =>
                      void saveGlobal({ apply_skin_ingame: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#10B981]"
                  />
                </label>

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
                  className="btn-accent w-full inline-flex items-center justify-center gap-2 rounded-lg disabled:opacity-50 py-2.5 text-xs font-semibold text-slate-950"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingSkin
                    ? "Guardando skin..."
                    : "Subir skin personalizada (.png)"}
                </button>
              </div>
            </section>
          )}

          {/* 5. APARIENCIA Y COMPORTAMIENTO */}
          {section === "appearance" && (
            <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Color de Acento Principal
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {ACCENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => void saveGlobal({ accent_color: opt.id })}
                      className={`rounded-lg py-2 px-2 flex flex-col items-center gap-1.5 border text-[11px] ${
                        config.accent_color === opt.id
                          ? "bg-[#171D2A] border-white/30 text-white"
                          : "bg-[#080A0F] border-[#1E2534] text-slate-400"
                      }`}
                    >
                      <span
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: opt.hex }}
                      />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Comportamiento al Lanzar Minecraft
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: "keep_open", label: "Mantener abierto" },
                      {
                        id: "hide_and_restore",
                        label: "Ocultar y restaurar",
                      },
                      { id: "close", label: "Cerrar launcher" },
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
                      className={`rounded-lg py-2 px-2.5 text-xs font-medium border ${
                        config.launch_behavior === opt.id
                          ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]"
                          : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between rounded-lg bg-[#080A0F] border border-[#1E2534] px-4 py-3 cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-white">
                    Abrir consola automáticamente si el juego crashea
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Despliega el cajón de logs al instante cuando Minecraft
                    termina con código de error.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={config.auto_open_console_on_crash}
                  onChange={(e) =>
                    void saveGlobal({
                      auto_open_console_on_crash: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-[#10B981]"
                />
              </label>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
