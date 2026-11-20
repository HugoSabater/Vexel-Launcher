import { AlertTriangle, Check, HardDrive } from "lucide-react";
import type {
  GcPreset,
  HardwareInfo,
  LauncherConfig,
  ProcessPriority,
  Profile,
} from "../types/launcher";

interface SettingsPerformancePanelProps {
  profile: Profile;
  config: LauncherConfig;
  hardware: HardwareInfo;
  dataRoot: string;
  onUpdateProfile: (updated: Profile) => Promise<void>;
  onSaveGlobalSettings: (
    username: string,
    priority: ProcessPriority,
    closeOnLaunch: boolean,
  ) => Promise<void>;
}

export function SettingsPerformancePanel({
  profile,
  config,
  hardware,
  dataRoot,
  onUpdateProfile,
  onSaveGlobalSettings,
}: SettingsPerformancePanelProps) {
  const recommendedMb =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;

  const totalMb = Math.max(hardware.total_ram_mb, 4096);
  const systemUsedMb = Math.max(
    1024,
    totalMb - hardware.available_ram_mb,
  );
  const mcMb = profile.ram_mb;
  const freeMb = Math.max(0, totalMb - systemUsedMb - mcMb);

  const sysPct = Math.min(100, (systemUsedMb / totalMb) * 100);
  const mcPct = Math.min(100 - sysPct, (mcMb / totalMb) * 100);
  const freePct = Math.max(0, 100 - sysPct - mcPct);

  const overSafeThreshold = mcMb > hardware.max_safe_ram_mb || freeMb < 1536;
  const sliderMax = Math.max(hardware.max_safe_ram_mb, totalMb - 1024);
  const recommendedTickPct = Math.min(
    100,
    Math.max(0, ((recommendedMb - 1024) / Math.max(1024, sliderMax - 1024)) * 100),
  );

  return (
    <div className="h-full overflow-y-auto p-5 bg-[#080A0F]">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">
              Rendimiento y Ajustes
            </h1>
            <p className="text-[11px] font-mono text-slate-500">
              Host: {(totalMb / 1024).toFixed(1)} GB RAM física ·{" "}
              {hardware.logical_cores} hilos lógicos · {profile.name}
            </p>
          </div>
        </div>

        {/* Visual Segmented RAM Meter */}
        <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-300">
              Asignación de Memoria RAM
            </h2>
            <span className="font-mono text-xs font-semibold text-[#38BDF8]">
              {mcMb} MB ({(mcMb / 1024).toFixed(1)} GB)
            </span>
          </div>

          {/* 3-Segment Bar: [Sistema] + [Minecraft] + [Libre] */}
          <div className="space-y-2">
            <div className="h-4 w-full rounded-lg bg-[#080A0F] border border-[#1E2534] overflow-hidden flex">
              <div
                style={{ width: `${sysPct}%` }}
                className="h-full bg-slate-600/70 border-r border-[#080A0F] transition-all duration-150"
                title={`Sistema: ${(systemUsedMb / 1024).toFixed(1)} GB`}
              />
              <div
                style={{ width: `${mcPct}%` }}
                className={`h-full border-r border-[#080A0F] transition-all duration-150 ${
                  overSafeThreshold ? "bg-[#F59E0B]" : "bg-[#38BDF8]"
                }`}
                title={`Minecraft: ${(mcMb / 1024).toFixed(1)} GB`}
              />
              <div
                style={{ width: `${freePct}%` }}
                className="h-full bg-transparent"
                title={`Libre: ${(freeMb / 1024).toFixed(1)} GB`}
              />
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
                Minecraft: {(mcMb / 1024).toFixed(1)} GB
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
              value={mcMb}
              onChange={(e) =>
                void onUpdateProfile({
                  ...profile,
                  ram_mb: Number(e.target.value),
                })
              }
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
                Asignación por encima del umbral seguro ({hardware.max_safe_ram_mb} MB).
                Superar este límite puede causar pausas del GC o paginación en Windows.
              </span>
            </div>
          )}
        </section>

        {/* Selectable Garbage Collector Cards */}
        <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-300">
            Motor Garbage Collector
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(
              [
                {
                  id: "generational_zgc" as GcPreset,
                  title: "Generational ZGC",
                  badge: "Java 21+ · <1ms pauses",
                  flags: "-XX:+UseZGC -XX:+ZGenerational",
                  desc: "Baja latencia extrema en carga de chunks. Degrada automáticamente a G1GC si la versión usa Java < 21.",
                },
                {
                  id: "aikar_g1_gc" as GcPreset,
                  title: "Aikar's G1GC",
                  badge: "Java 8 / 17 / 21 · Estable",
                  flags: "-XX:+UseG1GC -XX:MaxGCPauseMillis=200",
                  desc: "Perfil clásico afinado con regiones G1 escaladas automáticamente para heaps <12 GB y >=12 GB.",
                },
              ] as const
            ).map((gc) => {
              const selected = profile.gc_preset === gc.id;
              return (
                <button
                  key={gc.id}
                  type="button"
                  onClick={() =>
                    void onUpdateProfile({ ...profile, gc_preset: gc.id })
                  }
                  className={`text-left rounded-xl p-4 border transition-colors space-y-2 ${
                    selected
                      ? "bg-[#171D2A] border-[#38BDF8]"
                      : "bg-[#080A0F] border-[#1E2534] hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">
                      {gc.title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-[#11151E] border border-[#1E2534] px-2 py-0.5 text-[10px] font-mono text-[#38BDF8]">
                      {selected && <Check className="h-3 w-3" />}
                      {gc.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {gc.desc}
                  </p>
                  <code className="block rounded bg-[#080A0F] border border-[#1E2534] px-2 py-1 text-[10px] text-slate-300 truncate">
                    {gc.flags}
                  </code>
                </button>
              );
            })}
          </div>
        </section>

        {/* Win32 Scheduling, Zero-Overhead & QuickPlay */}
        <section className="rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-300">
            Sistema Operativo Windows y Red
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-slate-400">
                Prioridad de Proceso (Win32)
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

            <div className="space-y-1.5">
              <label className="block text-[11px] text-slate-400">
                Servidor Directo QuickPlay (IP:Puerto)
              </label>
              <input
                type="text"
                value={profile.server_address ?? ""}
                onChange={(e) =>
                  void onUpdateProfile({
                    ...profile,
                    server_address: e.target.value.trim()
                      ? e.target.value.trim()
                      : null,
                  })
                }
                placeholder="play.servidor.net:25565"
                className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs font-mono text-white focus:border-[#38BDF8] focus:outline-none"
              />
            </div>
          </div>

          <label className="flex items-center justify-between rounded-lg bg-[#080A0F] border border-[#1E2534] px-4 py-3 cursor-pointer">
            <div>
              <div className="text-xs font-medium text-white">
                Modo Cero Overhead
              </div>
              <div className="text-[11px] text-slate-500">
                Oculta la ventana WebView2 al lanzar Minecraft y la restaura
                automáticamente cuando el proceso finaliza.
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

          <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] px-3.5 py-2.5 flex items-center gap-2.5 text-[11px] text-slate-400">
            <HardDrive className="h-3.5 w-3.5 text-[#38BDF8] shrink-0" />
            <span className="font-mono truncate text-slate-500">{dataRoot}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
