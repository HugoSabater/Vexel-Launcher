import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Coffee,
  Download,
  Play,
  Server,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import type {
  HardwareInfo,
  JavaRuntimeStatus,
  JvmTuningOutput,
  LauncherConfig,
  LaunchProgressEvent,
  LogLineEvent,
  Profile,
} from "../types/launcher";

interface ProfileDashboardProps {
  profile: Profile;
  config: LauncherConfig;
  hardware: HardwareInfo;
  javaStatus: JavaRuntimeStatus | null;
  jvmTuning: JvmTuningOutput | null;
  launching: boolean;
  progress: LaunchProgressEvent | null;
  logs: LogLineEvent[];
  missingJavaMajor: number | null;
  installingJava: boolean;
  onPlay: () => Promise<void>;
  onConfirmInstallJava: (major: number) => Promise<void>;
  onDismissJavaModal: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ProfileDashboard({
  profile,
  config,
  hardware,
  javaStatus,
  jvmTuning,
  launching,
  progress,
  logs,
  missingJavaMajor,
  installingJava,
  onPlay,
  onConfirmInstallJava,
  onDismissJavaModal,
}: ProfileDashboardProps) {
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [flagsExpanded, setFlagsExpanded] = useState(false);

  const recommendedRam =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#334155] bg-[#0f172a] p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-[#38bdf8]/15 border border-[#38bdf8]/30 px-2.5 py-0.5 text-xs font-semibold text-[#38bdf8] uppercase">
                {profile.loader}
              </span>
              <span className="rounded-md bg-[#1e293b] border border-[#334155] px-2.5 py-0.5 text-xs font-mono text-slate-200">
                MC {profile.mc_version}
              </span>
              {profile.loader_version && (
                <span className="rounded-md bg-[#1e293b] border border-[#334155] px-2.5 py-0.5 text-xs font-mono text-slate-400">
                  Loader {profile.loader_version}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              {profile.name}
            </h2>
            <p className="text-xs text-slate-400">
              Jugador:{" "}
              <span className="text-slate-200 font-medium">
                {config.offline_username}
              </span>{" "}
              · Prioridad SO:{" "}
              <span className="text-[#38bdf8] font-mono">
                {config.process_priority}
              </span>
              {config.close_on_launch && " · Modo Cero Overhead activo"}
            </p>
          </div>

          <button
            type="button"
            disabled={launching || installingJava}
            onClick={() => void onPlay()}
            className="inline-flex items-center justify-center gap-3 rounded-xl bg-[#10b981] hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed px-8 py-4 text-base font-bold text-slate-950 shadow-lg shadow-emerald-950/50 transition-all"
          >
            <Play className="h-5 w-5 fill-current" />
            {launching ? "INICIANDO..." : "JUGAR"}
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-xl border border-[#334155] bg-[#1e293b]/70 p-3.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Zap className="h-3.5 w-3.5 text-[#38bdf8]" />
              Memoria JVM Asignada
            </div>
            <div className="mt-1 text-base font-bold text-white font-mono">
              {profile.ram_mb} MB
            </div>
            <div className="text-[11px] text-slate-400">
              Recomendado hardware: {recommendedRam} MB
            </div>
          </div>

          <div className="rounded-xl border border-[#334155] bg-[#1e293b]/70 p-3.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Coffee className="h-3.5 w-3.5 text-[#38bdf8]" />
              Runtime Java
            </div>
            <div className="mt-1 text-base font-bold text-white font-mono">
              {javaStatus
                ? `Java ${javaStatus.major}`
                : "Detectando manifiesto..."}
            </div>
            <div
              className={`text-[11px] ${
                javaStatus?.status === "installed"
                  ? "text-[#10b981]"
                  : "text-amber-400"
              }`}
            >
              {javaStatus?.status === "installed"
                ? "Adoptium JRE listo en caché"
                : javaStatus?.status === "missing"
                  ? "Pendiente de descarga Adoptium"
                  : "Verificando..."}
            </div>
          </div>

          <div className="rounded-xl border border-[#334155] bg-[#1e293b]/70 p-3.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-[#10b981]" />
              Garbage Collector
            </div>
            <div className="mt-1 text-base font-bold text-white">
              {jvmTuning?.effective_gc === "generational_zgc"
                ? "Generational ZGC"
                : "Aikar's G1GC"}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {jvmTuning?.fallback_notice
                ? "Fallback automático < Java 21"
                : `${jvmTuning?.flags.length ?? 0} flags activos`}
            </div>
          </div>

          <div className="rounded-xl border border-[#334155] bg-[#1e293b]/70 p-3.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Server className="h-3.5 w-3.5 text-[#38bdf8]" />
              Servidor Directo (QuickPlay)
            </div>
            <div className="mt-1 text-sm font-bold text-white font-mono truncate">
              {profile.server_address ?? "Menú Principal"}
            </div>
            <div className="text-[11px] text-slate-400">
              {profile.server_address
                ? "Auto-conexión al arrancar"
                : "Sin IP directa configurada"}
            </div>
          </div>
        </div>

        {progress && (
          <div className="mt-5 rounded-xl border border-[#334155] bg-[#0b1120] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#38bdf8]">
                {progress.phase}
              </span>
              <span className="font-mono text-slate-300">
                {progress.completed}/{progress.total} ({progressPct}%) ·{" "}
                {progress.fast_path_hits} Fast-Path hits
                {progress.bytes_downloaded > 0
                  ? ` · ${formatBytes(progress.bytes_downloaded)}`
                  : ""}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#1e293b]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#38bdf8] to-[#10b981] transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate">
              {progress.detail}
            </div>
          </div>
        )}

        {jvmTuning && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setFlagsExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#38bdf8] transition-colors"
            >
              {flagsExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              Ver argumentos JVM optimizados ({jvmTuning.flags.length})
            </button>
            {flagsExpanded && (
              <div className="mt-2 rounded-xl border border-[#334155] bg-[#0b1120] p-3 text-[11px] font-mono text-slate-300 break-all">
                {jvmTuning.flags.join(" ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#334155] bg-[#0f172a] overflow-hidden">
        <button
          type="button"
          onClick={() => setLogsExpanded((v) => !v)}
          className="w-full px-5 py-3 flex items-center justify-between border-b border-[#334155] bg-[#1e293b]/40 text-left"
        >
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <Terminal className="h-4 w-4 text-[#38bdf8]" />
            Consola del Proceso JVM ({logs.length} líneas)
          </span>
          {logsExpanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {logsExpanded && (
          <div className="h-64 overflow-y-auto bg-[#0b1120] p-4 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <p className="text-slate-500">
                Pulsa JUGAR para ver la salida en vivo de verificación, QuickPlay
                y stdout/stderr de Minecraft.
              </p>
            ) : (
              logs.map((entry, idx) => (
                <div
                  key={`${entry.timestamp}-${idx}`}
                  className={
                    entry.is_stderr ? "text-amber-300" : "text-slate-300"
                  }
                >
                  <span className="text-slate-600 mr-2">
                    [{entry.timestamp}]
                  </span>
                  {entry.line}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {missingJavaMajor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#334155] bg-[#0f172a] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#38bdf8]/15 border border-[#38bdf8]/30 flex items-center justify-center text-[#38bdf8]">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Java {missingJavaMajor} Requerido
                </h3>
                <p className="text-xs text-slate-400">
                  Minecraft {profile.mc_version} necesita Eclipse Temurin JRE{" "}
                  {missingJavaMajor}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              No se encontró una instalación local en{" "}
              <code className="text-[#38bdf8]">
                shared/runtimes/java-{missingJavaMajor}/
              </code>
              . ¿Deseas descargarlo y extraerlo automáticamente desde la API
              oficial de Eclipse Adoptium?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={installingJava}
                onClick={onDismissJavaModal}
                className="rounded-lg border border-[#334155] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#1e293b]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={installingJava}
                onClick={() => void onConfirmInstallJava(missingJavaMajor)}
                className="rounded-lg bg-[#10b981] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {installingJava
                  ? "Descargando JRE..."
                  : `Descargar Java ${missingJavaMajor}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
