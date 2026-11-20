import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Gauge,
  HardDrive,
  Server,
  Shirt,
  Upload,
} from "lucide-react";
import { SkinViewer3D } from "./SkinViewer3D";
import type {
  GcPreset,
  HardwareInfo,
  JvmTuningOutput,
  LauncherConfig,
  ProcessPriority,
  Profile,
} from "../types/launcher";

export type SettingsTab = "performance" | "skin" | "system";

interface SettingsPerformancePanelProps {
  profile: Profile;
  config: LauncherConfig;
  hardware: HardwareInfo;
  jvmTuning: JvmTuningOutput | null;
  skinDataUrl: string | null;
  dataRoot: string;
  initialTab?: SettingsTab;
  onUpdateProfile: (updated: Profile) => Promise<void>;
  onSaveGlobalSettings: (
    username: string,
    priority: ProcessPriority,
    closeOnLaunch: boolean,
  ) => Promise<void>;
  onUploadSkinBytes: (bytes: number[]) => Promise<void>;
  onSetSkinModel: (model: "classic" | "slim") => Promise<void>;
  onOpenDataRoot: () => Promise<void>;
}

export function SettingsPerformancePanel({
  profile,
  config,
  hardware,
  jvmTuning,
  skinDataUrl,
  dataRoot,
  initialTab = "performance",
  onUpdateProfile,
  onSaveGlobalSettings,
  onUploadSkinBytes,
  onSetSkinModel,
  onOpenDataRoot,
}: SettingsPerformancePanelProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [expertOpen, setExpertOpen] = useState(false);

  // Local draft state to avoid writing config.json on every pixel / keystroke
  const [ramDraft, setRamDraft] = useState<number>(profile.ram_mb);
  const [serverDraft, setServerDraft] = useState<string>(
    profile.server_address ?? "",
  );
  const [usernameDraft, setUsernameDraft] = useState<string>(
    config.offline_username,
  );
  const [uploadingSkin, setUploadingSkin] = useState(false);

  const serverDebounceRef = useRef<number | null>(null);
  const skinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setRamDraft(profile.ram_mb);
    setServerDraft(profile.server_address ?? "");
  }, [profile.id, profile.ram_mb, profile.server_address]);

  useEffect(() => {
    setUsernameDraft(config.offline_username);
  }, [config.offline_username]);

  const commitRam = (nextRam: number) => {
    if (nextRam !== profile.ram_mb) {
      void onUpdateProfile({ ...profile, ram_mb: nextRam });
    }
  };

  const commitServer = (value: string) => {
    const normalized = value.trim() ? value.trim() : null;
    if (normalized !== profile.server_address) {
      void onUpdateProfile({ ...profile, server_address: normalized });
    }
  };

  const handleServerChange = (value: string) => {
    setServerDraft(value);
    if (serverDebounceRef.current !== null) {
      window.clearTimeout(serverDebounceRef.current);
    }
    serverDebounceRef.current = window.setTimeout(() => {
      commitServer(value);
    }, 400);
  };

  const commitUsername = () => {
    const trimmed = usernameDraft.trim();
    if (trimmed && trimmed !== config.offline_username) {
      void onSaveGlobalSettings(
        trimmed,
        config.process_priority,
        config.close_on_launch,
      );
    } else {
      setUsernameDraft(config.offline_username);
    }
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

  const applySimplePreset = async (
    targetRam: number,
    gc: GcPreset,
    priority: ProcessPriority,
  ) => {
    setRamDraft(targetRam);
    await onUpdateProfile({
      ...profile,
      ram_mb: targetRam,
      gc_preset: gc,
    });
    await onSaveGlobalSettings(
      config.offline_username,
      priority,
      config.close_on_launch,
    );
  };

  return (
    <div className="h-full overflow-y-auto p-5 bg-[#080A0F]">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header + Internal Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Ajustes</h1>
            <p className="text-[11px] font-mono text-slate-500">
              {profile.name} · Host {(totalMb / 1024).toFixed(0)} GB RAM ·{" "}
              {hardware.logical_cores} hilos
            </p>
          </div>

          <div className="inline-flex rounded-lg bg-[#11151E] border border-[#1E2534] p-0.5">
            <button
              type="button"
              onClick={() => setTab("performance")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "performance"
                  ? "bg-[#171D2A] text-[#38BDF8]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Gauge className="h-3.5 w-3.5" />
              Rendimiento
            </button>
            <button
              type="button"
              onClick={() => setTab("skin")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "skin"
                  ? "bg-[#171D2A] text-[#38BDF8]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Shirt className="h-3.5 w-3.5" />
              Skin y Cuenta
            </button>
            <button
              type="button"
              onClick={() => setTab("system")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "system"
                  ? "bg-[#171D2A] text-[#38BDF8]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              Instancia y Sistema
            </button>
          </div>
        </div>

        {/* TAB 1: RENDIMIENTO (2 CAPAS) */}
        {tab === "performance" && (
          <div className="space-y-4">
            {/* Capa Simple: 3 Presets de 1 clic */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  id: "light",
                  title: "Ligero",
                  badge: `${lightRam} MB`,
                  desc: "Mínimo consumo para portátiles con multitarea abierta.",
                  active: ramDraft === lightRam && config.process_priority === "normal",
                  onClick: () =>
                    applySimplePreset(lightRam, "aikar_g1_gc", "normal"),
                },
                {
                  id: "balanced",
                  title: "Equilibrado",
                  badge: "Recomendado",
                  desc: `${balancedRam} MB · ZGC <1ms · Prioridad Above Normal.`,
                  active:
                    ramDraft === balancedRam &&
                    profile.gc_preset === "generational_zgc" &&
                    config.process_priority === "above_normal",
                  onClick: () =>
                    applySimplePreset(
                      balancedRam,
                      "generational_zgc",
                      "above_normal",
                    ),
                },
                {
                  id: "max",
                  title: "Máximos FPS",
                  badge: `${maxFpsRam} MB`,
                  desc: "Tope seguro para modpacks pesados + prioridad High.",
                  active:
                    ramDraft === maxFpsRam && config.process_priority === "high",
                  onClick: () =>
                    applySimplePreset(maxFpsRam, "generational_zgc", "high"),
                },
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void preset.onClick()}
                  className={`text-left rounded-xl p-4 border transition-colors space-y-1.5 ${
                    preset.active
                      ? "bg-[#171D2A] border-[#38BDF8]"
                      : "bg-[#11151E] border-[#1E2534] hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">
                      {preset.title}
                    </span>
                    <span className="rounded bg-[#080A0F] border border-[#1E2534] px-1.5 py-0.5 text-[10px] font-mono text-[#38BDF8]">
                      {preset.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {preset.desc}
                  </p>
                </button>
              ))}
            </section>

            {/* Visual Segmented RAM Meter + Debounced/PointerUp Slider */}
            <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-300">
                  Memoria RAM Asignada
                </h2>
                <span className="font-mono text-xs font-semibold text-[#38BDF8]">
                  {ramDraft} MB ({(ramDraft / 1024).toFixed(1)} GB)
                </span>
              </div>

              <div className="space-y-2">
                <div className="h-4 w-full rounded-lg bg-[#080A0F] border border-[#1E2534] overflow-hidden flex">
                  <div
                    style={{ width: `${sysPct}%` }}
                    className="h-full bg-slate-600/70 border-r border-[#080A0F] transition-all duration-150"
                  />
                  <div
                    style={{ width: `${mcPct}%` }}
                    className={`h-full border-r border-[#080A0F] transition-all duration-150 ${
                      overSafeThreshold ? "bg-[#F59E0B]" : "bg-[#38BDF8]"
                    }`}
                  />
                  <div style={{ width: `${freePct}%` }} className="h-full" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                    <span className="h-2 w-2 rounded-sm bg-slate-500" />
                    Sistema: {(systemUsedMb / 1024).toFixed(1)} GB
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      overSafeThreshold ? "text-[#F59E0B]" : "text-[#38BDF8]"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-sm ${
                        overSafeThreshold ? "bg-[#F59E0B]" : "bg-[#38BDF8]"
                      }`}
                    />
                    Minecraft: {(ramDraft / 1024).toFixed(1)} GB
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                    <span className="h-2 w-2 rounded-sm border border-[#1E2534] bg-[#080A0F]" />
                    Libre: {(freeMb / 1024).toFixed(1)} GB
                  </span>
                </div>
              </div>

              <div className="relative pt-1 pb-5">
                <input
                  type="range"
                  min={1024}
                  max={sliderMax}
                  step={512}
                  value={ramDraft}
                  onChange={(e) => setRamDraft(Number(e.target.value))}
                  onPointerUp={() => commitRam(ramDraft)}
                  onKeyUp={() => commitRam(ramDraft)}
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
                <div className="rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/35 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-[#F59E0B] shrink-0" />
                  <span>
                    Supera el umbral seguro para tu equipo (
                    {hardware.max_safe_ram_mb} MB). Asignar demasiada RAM en
                    portátiles con iGPU puede saturar Windows o alargar pausas
                    del GC.
                  </span>
                </div>
              )}
            </section>

            {/* Capa Experto (Colapsada por defecto) */}
            <section className="rounded-xl bg-[#11151E] border border-[#1E2534] overflow-hidden">
              <button
                type="button"
                onClick={() => setExpertOpen((v) => !v)}
                className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-[#171D2A]/50 transition-colors"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Ajustes avanzados de JVM y SO
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Garbage Collector, flags crudos, prioridad Win32 y ruta de
                    datos
                  </div>
                </div>
                {expertOpen ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {expertOpen && (
                <div className="px-5 pb-5 pt-2 border-t border-[#1E2534] space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(
                      [
                        {
                          id: "generational_zgc" as GcPreset,
                          title: "Generational ZGC",
                          badge: "Java 21+ · <1ms",
                          flags: "-XX:+UseZGC -XX:+ZGenerational",
                        },
                        {
                          id: "aikar_g1_gc" as GcPreset,
                          title: "Aikar's G1GC",
                          badge: "Java 8 / 17 / 21",
                          flags: "-XX:+UseG1GC -XX:MaxGCPauseMillis=200",
                        },
                      ] as const
                    ).map((gc) => {
                      const selected = profile.gc_preset === gc.id;
                      return (
                        <button
                          key={gc.id}
                          type="button"
                          onClick={() =>
                            void onUpdateProfile({
                              ...profile,
                              gc_preset: gc.id,
                            })
                          }
                          className={`text-left rounded-lg p-3.5 border transition-colors space-y-1.5 ${
                            selected
                              ? "bg-[#171D2A] border-[#38BDF8]"
                              : "bg-[#080A0F] border-[#1E2534] hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-white">
                              {gc.title}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[#38BDF8]">
                              {selected && <Check className="h-3 w-3" />}
                              {gc.badge}
                            </span>
                          </div>
                          <code className="block text-[10px] text-slate-400 truncate">
                            {gc.flags}
                          </code>
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-slate-400">
                      Prioridad de Proceso Windows (Win32)
                    </label>
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
                            void onSaveGlobalSettings(
                              config.offline_username,
                              opt.id,
                              config.close_on_launch,
                            )
                          }
                          className={`rounded-md py-1.5 text-[11px] font-medium transition-colors ${
                            config.process_priority === opt.id
                              ? "bg-[#171D2A] text-[#38BDF8] border border-[#1E2534]"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {jvmTuning && (
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400">
                        Flags JVM generados ({jvmTuning.flags.length})
                      </span>
                      <div className="selectable-logs rounded-lg bg-[#080A0F] border border-[#1E2534] p-3 text-[10px] font-mono text-slate-400 break-all">
                        {jvmTuning.flags.join(" ")}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] px-3 py-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <HardDrive className="h-3.5 w-3.5 text-[#38BDF8] shrink-0" />
                    <span className="font-mono truncate">{dataRoot}</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: SKIN Y CUENTA */}
        {tab === "skin" && (
          <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-5 flex flex-col items-center justify-center rounded-xl bg-[#080A0F] border border-[#1E2534] py-4">
              <SkinViewer3D
                skinUrl={skinDataUrl}
                model={config.skin_model}
                width={230}
                height={300}
              />
              <span className="text-[10px] font-mono text-slate-500 mt-1">
                Arrastra para girar · Modelo {config.skin_model}
              </span>
            </div>

            <div className="md:col-span-7 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  Nombre de Usuario Offline
                </label>
                <input
                  type="text"
                  value={usernameDraft}
                  onChange={(e) => setUsernameDraft(e.target.value)}
                  onBlur={commitUsername}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitUsername();
                  }}
                  className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Modelo de Brazos
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void onSetSkinModel("classic")}
                    className={`rounded-lg py-2 px-3 text-xs font-medium border transition-colors ${
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
                    className={`rounded-lg py-2 px-3 text-xs font-medium border transition-colors ${
                      config.skin_model === "slim"
                        ? "bg-[#171D2A] text-[#38BDF8] border-[#38BDF8]"
                        : "bg-[#080A0F] text-slate-400 border-[#1E2534]"
                    }`}
                  >
                    Delgado (3px · Alex)
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-1">
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
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 py-2.5 text-xs font-semibold text-slate-950 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingSkin
                    ? "Guardando skin..."
                    : "Subir skin personalizada (.png)"}
                </button>
                <p className="text-[11px] text-slate-500">
                  Se guarda localmente en{" "}
                  <code className="text-slate-400">
                    shared/skins/custom_skin.png
                  </code>{" "}
                  (64×64 o 64×32 PNG).
                </p>
              </div>
            </div>
          </section>
        )}

        {/* TAB 3: INSTANCIA Y SISTEMA */}
        {tab === "system" && (
          <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">
                Servidor Directo QuickPlay (IP:Puerto)
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
                className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
              />
            </div>

            <label className="flex items-center justify-between rounded-lg bg-[#080A0F] border border-[#1E2534] px-4 py-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-white">
                  Modo Cero Overhead
                </div>
                <div className="text-[11px] text-slate-500">
                  Oculta WebView2 al arrancar Minecraft y restaura la ventana
                  automáticamente cuando el juego termina.
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.close_on_launch}
                onChange={(e) =>
                  void onSaveGlobalSettings(
                    config.offline_username,
                    config.process_priority,
                    e.target.checked,
                  )
                }
                className="h-4 w-4 accent-[#10B981]"
              />
            </label>

            <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200">
                  Carpeta Raíz de Datos Híbrida
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate">
                  {dataRoot}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onOpenDataRoot()}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#11151E] hover:bg-[#171D2A] border border-[#1E2534] px-3 py-1.5 text-xs text-slate-200"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#38BDF8]" />
                Abrir carpeta
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
