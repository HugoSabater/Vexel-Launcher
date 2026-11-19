import {
  Download,
  Play,
  Radio,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import type {
  JavaRuntimeStatus,
  JvmTuningOutput,
  LaunchProgressEvent,
  ModLoaderKind,
  Profile,
} from "../types/launcher";

interface ProfileDashboardProps {
  profile: Profile;
  javaStatus: JavaRuntimeStatus | null;
  jvmTuning: JvmTuningOutput | null;
  launching: boolean;
  isRunning: boolean;
  progress: LaunchProgressEvent | null;
  missingJavaMajor: number | null;
  installingJava: boolean;
  javaInstallProgress: LaunchProgressEvent | null;
  onPlay: () => Promise<void>;
  onStop: () => Promise<void>;
  onOpenSettings: () => void;
  onConfirmInstallJava: (major: number) => Promise<void>;
  onDismissJavaModal: () => void;
}

const STAGE_VIGNETTE: Record<ModLoaderKind, string> = {
  vanilla:
    "radial-gradient(80% 70% at 65% 22%, rgba(16, 185, 129, 0.12) 0%, rgba(10, 12, 16, 0) 70%)",
  fabric:
    "radial-gradient(80% 70% at 65% 22%, rgba(56, 189, 248, 0.12) 0%, rgba(10, 12, 16, 0) 70%)",
  forge:
    "radial-gradient(80% 70% at 65% 22%, rgba(245, 158, 11, 0.12) 0%, rgba(10, 12, 16, 0) 70%)",
  neo_forge:
    "radial-gradient(80% 70% at 65% 22%, rgba(249, 115, 22, 0.12) 0%, rgba(10, 12, 16, 0) 70%)",
};

const LOADER_LABEL: Record<ModLoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neo_forge: "NeoForge",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRamGb(ramMb: number): string {
  const gb = ramMb / 1024;
  return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
}

export function ProfileDashboard({
  profile,
  javaStatus,
  jvmTuning,
  launching,
  isRunning,
  progress,
  missingJavaMajor,
  installingJava,
  javaInstallProgress,
  onPlay,
  onStop,
  onOpenSettings,
  onConfirmInstallJava,
  onDismissJavaModal,
}: ProfileDashboardProps) {
  const gcLabel =
    jvmTuning?.effective_gc === "generational_zgc" ? "ZGC" : "G1GC";

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  const isWorking = launching || installingJava;

  return (
    <div className="h-full w-full flex flex-col bg-[#0A0C10]">
      {/* Full-Bleed Atmospheric Stage (75%+ breathing room) */}
      <div
        className="relative flex-1 flex flex-col justify-end px-10 pb-10 overflow-hidden"
        style={{ background: STAGE_VIGNETTE[profile.loader] }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
          }}
        />

        <div className="relative max-w-2xl space-y-3">
          {profile.server_address && (
            <div className="inline-flex items-center gap-2 rounded-full bg-[#181D28]/90 border border-white/[0.06] px-3 py-1 text-[11px] font-mono text-[#38BDF8]">
              <Radio className="h-3 w-3" />
              <span>QuickPlay · {profile.server_address}</span>
            </div>
          )}

          <h1 className="text-4xl font-semibold tracking-tight text-white">
            {profile.name}
          </h1>

          {javaStatus?.status === "missing" && (
            <p className="text-xs font-mono text-slate-400">
              Requiere Eclipse Temurin Java {javaStatus.major} (instalación
              automática al iniciar)
            </p>
          )}
        </div>
      </div>

      {/* Bottom Action Dock */}
      <footer className="relative h-[74px] shrink-0 bg-[#10131A] border-t border-white/[0.06] px-6 flex items-center justify-between gap-4">
        {/* Integrated Top-Edge Hairline Progress Bar */}
        {isWorking && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/[0.05] overflow-hidden">
            <div
              className="h-full bg-[#38BDF8] shadow-[0_0_10px_#38BDF8] transition-all duration-150"
              style={{ width: `${Math.max(8, progressPct)}%` }}
            />
          </div>
        )}

        {/* Left: Discreet Single-Line Monospace Spec */}
        <div className="min-w-0 flex flex-col justify-center">
          <div className="text-xs font-mono text-slate-300 truncate">
            {profile.mc_version} · {LOADER_LABEL[profile.loader]} ·{" "}
            {formatRamGb(profile.ram_mb)} · {gcLabel}
          </div>
          {isWorking && progress ? (
            <div className="mt-0.5 text-[11px] font-mono text-[#38BDF8] truncate">
              {progress.phase}
              {progress.total > 0 ? ` (${progressPct}%)` : ""} ·{" "}
              {progress.detail}
            </div>
          ) : isRunning ? (
            <div className="mt-0.5 text-[11px] font-mono text-[#10B981]">
              Instancia en ejecución
            </div>
          ) : null}
        </div>

        {/* Right: Protagonist Action Button + Quick Settings */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            title="Ajustes rápidos del perfil"
            className="h-10 w-10 rounded-lg bg-[#181D28] hover:bg-white/[0.08] border border-white/[0.06] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          {isRunning ? (
            <button
              type="button"
              onClick={() => void onStop()}
              className="h-10 min-w-[148px] px-6 rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-[0.99] inline-flex items-center justify-center gap-2 text-xs font-bold tracking-wider text-white transition-all"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              DETENER
            </button>
          ) : (
            <button
              type="button"
              disabled={isWorking}
              onClick={() => void onPlay()}
              className="h-10 min-w-[148px] px-6 rounded-lg bg-[#10B981] hover:bg-[#059669] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 text-xs font-bold tracking-wider text-slate-950 transition-all"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {launching ? "INICIANDO..." : "JUGAR"}
            </button>
          )}
        </div>
      </footer>

      {/* Adoptium JRE Confirmation & Progress Modal */}
      {missingJavaMajor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[#10131A] border border-white/[0.08] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[#181D28] border border-white/[0.06] flex items-center justify-center text-[#38BDF8]">
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
              sin modificar tu sistema.
            </p>

            {installingJava && javaInstallProgress && (
              <div className="rounded-lg bg-[#0A0C10] border border-white/[0.06] p-3.5 space-y-2">
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

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
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

            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                disabled={installingJava}
                onClick={onDismissJavaModal}
                className="rounded-lg border border-white/[0.06] px-3.5 py-1.5 text-xs text-slate-300 hover:bg-[#181D28] disabled:opacity-40"
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
