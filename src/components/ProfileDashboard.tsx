import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Download,
  FolderOpen,
  Package,
  Play,
  Radio,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import type {
  ContentItem,
  ContentKind,
  HardwareInfo,
  JavaRuntimeStatus,
  JvmTuningOutput,
  LauncherConfig,
  LaunchProgressEvent,
  ModLoaderKind,
  Profile,
} from "../types/launcher";

interface ProfileDashboardProps {
  profile: Profile;
  config: LauncherConfig;
  hardware: HardwareInfo;
  javaStatus: JavaRuntimeStatus | null;
  jvmTuning: JvmTuningOutput | null;
  launching: boolean;
  isRunning: boolean;
  progress: LaunchProgressEvent | null;
  missingJavaMajor: number | null;
  installingJava: boolean;
  javaInstallProgress: LaunchProgressEvent | null;
  onListContent: (
    profileId: string,
    kind: ContentKind,
  ) => Promise<ContentItem[]>;
  onPlay: () => Promise<void>;
  onStop: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onOpenMods: () => void;
  onOpenPerformance: () => void;
  onConfirmInstallJava: (major: number) => Promise<void>;
  onDismissJavaModal: () => void;
}

const HERO_BG: Record<ModLoaderKind, string> = {
  vanilla:
    "radial-gradient(100% 120% at 0% 0%, rgba(16, 185, 129, 0.16) 0%, rgba(17, 21, 30, 0.92) 55%, #11151E 100%)",
  fabric:
    "radial-gradient(100% 120% at 0% 0%, rgba(56, 189, 248, 0.16) 0%, rgba(17, 21, 30, 0.92) 55%, #11151E 100%)",
  forge:
    "radial-gradient(100% 120% at 0% 0%, rgba(245, 158, 11, 0.16) 0%, rgba(17, 21, 30, 0.92) 55%, #11151E 100%)",
  neo_forge:
    "radial-gradient(100% 120% at 0% 0%, rgba(249, 115, 22, 0.16) 0%, rgba(17, 21, 30, 0.92) 55%, #11151E 100%)",
};

const LOADER_BADGE: Record<ModLoaderKind, string> = {
  vanilla: "bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30",
  fabric: "bg-[#38BDF8]/15 text-[#38BDF8] border-[#38BDF8]/30",
  forge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  neo_forge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProfileDashboard({
  profile,
  config,
  hardware,
  javaStatus,
  jvmTuning,
  launching,
  isRunning,
  progress,
  missingJavaMajor,
  installingJava,
  javaInstallProgress,
  onListContent,
  onPlay,
  onStop,
  onOpenFolder,
  onOpenMods,
  onOpenPerformance,
  onConfirmInstallJava,
  onDismissJavaModal,
}: ProfileDashboardProps) {
  const [activeMods, setActiveMods] = useState<ContentItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void onListContent(profile.id, "mod")
      .then((items) => {
        if (!cancelled) {
          setActiveMods(items.filter((m) => m.enabled));
        }
      })
      .catch(() => {
        if (!cancelled) setActiveMods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onListContent, profile.id]);

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  const isWorking = launching || installingJava;
  const recommendedMb =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;

  return (
    <div className="h-full w-full overflow-y-auto bg-[#080A0F] p-5">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Compact Atmospheric Hero Banner */}
        <section
          className="relative overflow-hidden rounded-xl border border-[#1E2534] p-5"
          style={{ background: HERO_BG[profile.loader] }}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase ${LOADER_BADGE[profile.loader]}`}
                >
                  {profile.loader}
                </span>
                <span className="rounded bg-[#080A0F] border border-[#1E2534] px-2 py-0.5 text-[11px] font-mono text-slate-200">
                  MC {profile.mc_version}
                </span>
                {isRunning && (
                  <span className="inline-flex items-center gap-1.5 rounded bg-[#10B981]/15 border border-[#10B981]/30 px-2 py-0.5 text-[10px] font-mono text-[#10B981]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#10B981] animate-pulse" />
                    RUNNING
                  </span>
                )}
              </div>

              <h1 className="text-2xl font-semibold tracking-tight text-white truncate">
                {profile.name}
              </h1>

              <p className="text-xs font-mono text-slate-400">
                {javaStatus
                  ? `Temurin Java ${javaStatus.major} (${javaStatus.status === "installed" ? "local" : "auto-install"})`
                  : "Verificando runtime..."}{" "}
                · {activeMods.length} mods activos
                {isWorking && progress ? ` · ${progress.phase}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void onOpenFolder()}
                title="Abrir carpeta de la instancia"
                className="h-10 w-10 rounded-lg bg-[#080A0F]/80 hover:bg-[#171D2A] border border-[#1E2534] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
              >
                <FolderOpen className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onOpenPerformance}
                title="Ajustes de rendimiento"
                className="h-10 w-10 rounded-lg bg-[#080A0F]/80 hover:bg-[#171D2A] border border-[#1E2534] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>

              {isRunning ? (
                <button
                  type="button"
                  onClick={() => void onStop()}
                  className="h-10 min-w-[144px] px-5 rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-[0.99] inline-flex items-center justify-center gap-2 text-xs font-bold tracking-wider text-white transition-all"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  DETENER
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => void onPlay()}
                  className="h-10 min-w-[144px] px-5 rounded-lg bg-[#10B981] hover:bg-[#059669] active:scale-[0.99] disabled:opacity-50 inline-flex items-center justify-center gap-2 text-xs font-bold tracking-wider text-slate-950 transition-all"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {launching ? "INICIANDO..." : "JUGAR"}
                </button>
              )}
            </div>
          </div>

          {/* Crisp 2px Cyan Progress Line on Bottom Edge of Hero Banner */}
          {isWorking && (
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1E2534]">
              <div
                className="h-full bg-[#38BDF8] transition-all duration-150"
                style={{ width: `${Math.max(8, progressPct)}%` }}
              />
            </div>
          )}
        </section>

        {/* Asymmetric 12-Column Row: 7 cols QuickPlay + Mods | 5 cols Unified Execution Profile */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 7 Cols: QuickPlay + Active Mods */}
          <section className="lg:col-span-7 rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              {/* QuickPlay Row */}
              <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2.5">
                  <Radio
                    className={`h-4 w-4 shrink-0 ${
                      profile.server_address
                        ? "text-[#38BDF8]"
                        : "text-slate-600"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-400">
                      QuickPlay Direct Server
                    </div>
                    <div className="text-xs font-mono text-white truncate">
                      {profile.server_address ?? "Menú Principal (Sin IP directa)"}
                    </div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-mono ${
                    profile.server_address
                      ? "bg-[#10B981]/12 text-[#10B981] border-[#10B981]/30"
                      : "bg-[#11151E] text-slate-500 border-[#1E2534]"
                  }`}
                >
                  {profile.server_address ? "Direct Ready" : "Local"}
                </span>
              </div>

              {/* Active Mods List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <Package className="h-3.5 w-3.5 text-[#38BDF8]" />
                    Mods Activos ({activeMods.length})
                  </span>
                  <button
                    type="button"
                    onClick={onOpenMods}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#38BDF8] hover:underline"
                  >
                    Gestionar / Recomendados
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>

                {activeMods.length === 0 ? (
                  <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      Sin mods instalados en esta instancia.
                    </span>
                    {profile.loader === "fabric" && (
                      <button
                        type="button"
                        onClick={onOpenMods}
                        className="shrink-0 rounded-md bg-[#10B981]/15 border border-[#10B981]/30 px-2.5 py-1 text-[11px] font-medium text-[#10B981] hover:bg-[#10B981]/25"
                      >
                        Instalar FPS Puros
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-[#1E2534] rounded-lg bg-[#080A0F] border border-[#1E2534] overflow-hidden">
                    {activeMods.slice(0, 6).map((mod) => (
                      <div
                        key={mod.file_name}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="truncate text-slate-200 font-medium">
                          {mod.display_name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          {formatBytes(mod.size_bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 5 Cols: Single Unified Execution Profile Ledger */}
          <section className="lg:col-span-5 rounded-xl bg-[#11151E] border border-[#1E2534] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#1E2534] pb-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-300">
                Perfil de Ejecución
              </h2>
              <button
                type="button"
                onClick={onOpenPerformance}
                className="text-[11px] font-mono text-[#38BDF8] hover:underline"
              >
                Ajustar
              </button>
            </div>

            <dl className="divide-y divide-[#1E2534] text-xs">
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="text-slate-400">Heap RAM</dt>
                <dd className="font-mono text-white">
                  {profile.ram_mb} MB{" "}
                  <span className="text-slate-500">
                    / opt {recommendedMb} MB
                  </span>
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="text-slate-400">Garbage Collector</dt>
                <dd className="font-mono text-[#38BDF8]">
                  {jvmTuning?.effective_gc === "generational_zgc"
                    ? "Generational ZGC"
                    : "Aikar's G1GC"}
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="text-slate-400">Runtime Java</dt>
                <dd className="font-mono text-slate-200">
                  {javaStatus ? `Temurin ${javaStatus.major}` : "..."}
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="text-slate-400">Prioridad Win32</dt>
                <dd className="font-mono text-slate-200 uppercase">
                  {config.process_priority}
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="text-slate-400">Integridad Caché</dt>
                <dd className="font-mono text-[#10B981]">O(1) Fast-Path &lt;1s</dd>
              </div>
              <div className="py-2 flex items-center justify-between gap-2">
                <dt className="text-slate-400">Modo Cero Overhead</dt>
                <dd className="font-mono text-slate-200">
                  {config.close_on_launch ? "Activado" : "Desactivado"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      {/* Adoptium JRE Confirmation & Progress Modal */}
      {missingJavaMajor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[#11151E] border border-[#1E2534] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[#080A0F] border border-[#1E2534] flex items-center justify-center text-[#38BDF8]">
                <Download
                  className={`h-4 w-4 ${installingJava ? "animate-bounce" : ""}`}
                />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Eclipse Temurin Java {missingJavaMajor} Requerido
                </h3>
                <p className="text-[11px] font-mono text-slate-400">
                  MC {profile.mc_version} · shared/runtimes/java-
                  {missingJavaMajor}/
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              No se detectó un runtime local para Java {missingJavaMajor}. Se
              descargará el JRE oficial x64 desde{" "}
              <span className="font-mono text-[#38BDF8]">api.adoptium.net</span>{" "}
              sin alterar tu sistema.
            </p>

            {installingJava && javaInstallProgress && (
              <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-[#38BDF8]">
                    {javaInstallProgress.phase}
                  </span>
                  <span className="font-mono font-semibold text-white">
                    {javaInstallProgress.total > 0
                      ? `${Math.min(100, Math.round((javaInstallProgress.completed / javaInstallProgress.total) * 100))}%`
                      : "..."}
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1E2534]">
                  <div
                    className={`h-full rounded-full bg-[#38BDF8] transition-all duration-150 ${
                      javaInstallProgress.total === 0
                        ? "w-1/2 animate-pulse"
                        : ""
                    }`}
                    style={
                      javaInstallProgress.total > 0
                        ? {
                            width: `${Math.min(100, Math.round((javaInstallProgress.completed / javaInstallProgress.total) * 100))}%`,
                          }
                        : undefined
                    }
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 gap-2">
                  <span className="truncate">{javaInstallProgress.detail}</span>
                  <span className="shrink-0 text-slate-300">
                    {formatBytes(javaInstallProgress.bytes_downloaded)}
                    {javaInstallProgress.fast_path_hits > 0
                      ? ` / ${formatBytes(javaInstallProgress.fast_path_hits * 1024)}`
                      : ""}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-[#1E2534]">
              <button
                type="button"
                disabled={installingJava}
                onClick={onDismissJavaModal}
                className="rounded-lg border border-[#1E2534] px-3.5 py-1.5 text-xs text-slate-300 hover:bg-[#171D2A] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={installingJava}
                onClick={() => void onConfirmInstallJava(missingJavaMajor)}
                className="rounded-lg bg-[#10B981] hover:bg-[#059669] px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
              >
                {installingJava
                  ? javaInstallProgress?.phase ?? "Instalando JRE..."
                  : `Instalar Java ${missingJavaMajor}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
