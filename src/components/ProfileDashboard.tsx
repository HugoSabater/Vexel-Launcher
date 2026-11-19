import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Coffee,
  Copy,
  Download,
  Gauge,
  Play,
  Radio,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import type {
  HardwareInfo,
  JavaRuntimeStatus,
  JvmTuningOutput,
  LauncherConfig,
  LaunchProgressEvent,
  LogLineEvent,
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
  progress: LaunchProgressEvent | null;
  logs: LogLineEvent[];
  missingJavaMajor: number | null;
  installingJava: boolean;
  javaInstallProgress: LaunchProgressEvent | null;
  onPlay: () => Promise<void>;
  onClearLogs: () => void;
  onConfirmInstallJava: (major: number) => Promise<void>;
  onDismissJavaModal: () => void;
}

const HERO_ATMOSPHERE: Record<ModLoaderKind, { bg: string; badge: string; label: string }> = {
  vanilla: {
    bg: "radial-gradient(120% 100% at 0% 0%, rgba(16, 185, 129, 0.16) 0%, rgba(14, 18, 26, 0.4) 55%, rgba(9, 11, 16, 0.9) 100%)",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    label: "VANILLA",
  },
  fabric: {
    bg: "radial-gradient(120% 100% at 0% 0%, rgba(56, 189, 248, 0.16) 0%, rgba(14, 18, 26, 0.4) 55%, rgba(9, 11, 16, 0.9) 100%)",
    badge: "bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/30",
    label: "FABRIC",
  },
  forge: {
    bg: "radial-gradient(120% 100% at 0% 0%, rgba(245, 158, 11, 0.16) 0%, rgba(14, 18, 26, 0.4) 55%, rgba(9, 11, 16, 0.9) 100%)",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    label: "FORGE",
  },
  neo_forge: {
    bg: "radial-gradient(120% 100% at 0% 0%, rgba(249, 115, 22, 0.16) 0%, rgba(14, 18, 26, 0.4) 55%, rgba(9, 11, 16, 0.9) 100%)",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    label: "NEOFORGE",
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function classifyLogLine(entry: LogLineEvent): {
  textClass: string;
  tag: string | null;
  tagClass: string;
} {
  const upper = entry.line.toUpperCase();
  if (entry.is_stderr || upper.includes("[ERROR]") || upper.includes("FATAL") || upper.includes("EXCEPTION")) {
    return {
      textClass: "text-rose-300",
      tag: "ERR",
      tagClass: "bg-rose-500/15 text-rose-300 border-rose-500/25",
    };
  }
  if (upper.includes("[WARN]") || upper.includes("WARNING")) {
    return {
      textClass: "text-amber-300",
      tag: "WARN",
      tagClass: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    };
  }
  if (
    entry.line.startsWith("[Win32 Tuning]") ||
    entry.line.startsWith("[JVM Optimizer]") ||
    entry.line.startsWith("[Launcher]")
  ) {
    return {
      textClass: "text-[#38bdf8]",
      tag: "SYS",
      tagClass: "bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/25",
    };
  }
  if (upper.includes("[INFO]")) {
    return {
      textClass: "text-slate-200",
      tag: "INFO",
      tagClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    };
  }
  return {
    textClass: "text-slate-300",
    tag: null,
    tagClass: "",
  };
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
  javaInstallProgress,
  onPlay,
  onClearLogs,
  onConfirmInstallJava,
  onDismissJavaModal,
}: ProfileDashboardProps) {
  const [flagsExpanded, setFlagsExpanded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    const text = logs
      .map((l) => `[${l.timestamp}] ${l.line}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const hero = HERO_ATMOSPHERE[profile.loader];
  const recommendedRam =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  return (
    <div className="space-y-4">
      {/* Dynamic Hero Banner */}
      <section
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] obsidian-inset p-6"
        style={{ background: hero.bg }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold tracking-wider ${hero.badge}`}
              >
                {hero.label}
              </span>
              <span className="rounded-md bg-[#090b10]/80 border border-white/[0.08] px-2 py-0.5 text-[11px] font-mono text-slate-200">
                v{profile.mc_version}
              </span>
              {profile.server_address && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#38bdf8]/10 border border-[#38bdf8]/25 px-2.5 py-0.5 text-[11px] font-mono text-[#38bdf8]">
                  <Radio className="h-3 w-3 animate-pulse" />
                  QuickPlay · {profile.server_address}
                </span>
              )}
            </div>

            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white truncate">
                {profile.name}
              </h2>
              <p className="mt-1 text-xs text-slate-400 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span>
                  Cuenta{" "}
                  <span className="font-mono text-slate-200">
                    {config.offline_username}
                  </span>
                </span>
                <span className="text-slate-600">•</span>
                <span>
                  Win32{" "}
                  <span className="font-mono text-[#38bdf8]">
                    {config.process_priority}
                  </span>
                </span>
                {config.close_on_launch && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="font-mono text-emerald-400">
                      Zero-Overhead
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={launching || installingJava}
            onClick={() => void onPlay()}
            className="shrink-0 inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] active:scale-[0.985] disabled:opacity-60 disabled:cursor-not-allowed px-8 py-3.5 text-sm font-bold tracking-wide text-slate-950 play-glow transition-all"
          >
            <Play className="h-4 w-4 fill-current" />
            {launching ? "INICIANDO..." : "JUGAR"}
          </button>
        </div>

        {/* Compact Monospace Telemetry Strip */}
        <div className="relative mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="rounded-xl obsidian-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Gauge className="h-3.5 w-3.5 text-[#38bdf8]" />
              Heap JVM
            </div>
            <div className="mt-1 text-sm font-mono font-semibold text-white">
              {profile.ram_mb} MB
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              óptimo {recommendedRam} MB
            </div>
          </div>

          <div className="rounded-xl obsidian-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Coffee className="h-3.5 w-3.5 text-[#38bdf8]" />
              Runtime Java
            </div>
            <div className="mt-1 text-sm font-mono font-semibold text-white">
              {javaStatus ? `Temurin ${javaStatus.major}` : "Verificando..."}
            </div>
            <div
              className={`text-[10px] font-mono ${
                javaStatus?.status === "installed"
                  ? "text-[#10b981]"
                  : "text-amber-400"
              }`}
            >
              {javaStatus?.status === "installed"
                ? "ready · local cache"
                : javaStatus?.status === "missing"
                  ? "missing · auto-install"
                  : "..."}
            </div>
          </div>

          <div className="rounded-xl obsidian-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-[#10b981]" />
              Garbage Collector
            </div>
            <div className="mt-1 text-sm font-mono font-semibold text-white">
              {jvmTuning?.effective_gc === "generational_zgc"
                ? "Gen-ZGC"
                : "Aikar G1GC"}
            </div>
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {jvmTuning?.fallback_notice
                ? "fallback < JDK 21"
                : `${jvmTuning?.flags.length ?? 0} flags`}
            </div>
          </div>

          <div className="rounded-xl obsidian-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Radio className="h-3.5 w-3.5 text-[#38bdf8]" />
              Destino
            </div>
            <div className="mt-1 text-xs font-mono font-semibold text-white truncate">
              {profile.server_address ?? "Main Menu"}
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              {profile.server_address ? "quickplay enabled" : "offline local"}
            </div>
          </div>
        </div>

        {/* Multi-Phase Live Progress Bar */}
        {progress && (
          <div className="relative mt-4 rounded-xl bg-[#06080d]/90 border border-white/[0.08] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[#38bdf8]">
                {progress.phase}
              </span>
              <span className="font-mono text-slate-300">
                {progress.completed}/{progress.total} ({progressPct}%) ·{" "}
                <span className="text-[#10b981]">
                  {progress.fast_path_hits} hits O(1)
                </span>
                {progress.bytes_downloaded > 0
                  ? ` · ${formatBytes(progress.bytes_downloaded)}`
                  : ""}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-[#38bdf8] transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {progress.detail}
            </div>
          </div>
        )}

        {/* Collapsible JVM Flags Drawer */}
        {jvmTuning && (
          <div className="relative mt-3.5">
            <button
              type="button"
              onClick={() => setFlagsExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-[#38bdf8] transition-colors"
            >
              {flagsExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              jvm_flags[{jvmTuning.flags.length}]
            </button>
            {flagsExpanded && (
              <div className="mt-2 rounded-xl bg-[#06080d] border border-white/[0.07] p-3 text-[11px] font-mono text-slate-300 leading-relaxed break-all">
                {jvmTuning.flags.join(" ")}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Embedded Terminal-Style Execution Console */}
      <section className="rounded-2xl border border-white/[0.07] bg-[#06080d] overflow-hidden obsidian-inset">
        <div className="px-4 py-2.5 border-b border-white/[0.07] bg-[#0e121a]/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-3.5 w-3.5 text-[#38bdf8]" />
            <span className="text-xs font-semibold text-slate-200">
              Process Console
            </span>
            <span className="rounded bg-white/[0.05] border border-white/[0.07] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
              {logs.length} lines
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              className={`rounded-md border px-2 py-1 text-[10px] font-mono transition-colors ${
                autoScroll
                  ? "bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/30"
                  : "bg-white/[0.03] text-slate-400 border-white/[0.07] hover:text-slate-200"
              }`}
            >
              auto-scroll: {autoScroll ? "on" : "off"}
            </button>

            <button
              type="button"
              onClick={() => void handleCopyLogs()}
              disabled={logs.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.07] disabled:opacity-40 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-[#10b981]" />
                  copiado
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  copiar
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClearLogs}
              disabled={logs.length === 0}
              title="Limpiar consola"
              className="p-1 rounded-md border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.07] disabled:opacity-40 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div
          ref={terminalRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            if (!atBottom && autoScroll) {
              setAutoScroll(false);
            }
          }}
          className="h-64 overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-[1.6] space-y-1"
        >
          {logs.length === 0 ? (
            <div className="text-slate-600 select-none">
              <span className="text-[#38bdf8]">$</span> awaiting launch signal —
              click <span className="text-[#10b981]">JUGAR</span> to stream
              integrity verification, Win32 priority and JVM stdout/stderr.
            </div>
          ) : (
            logs.map((entry, idx) => {
              const style = classifyLogLine(entry);
              return (
                <div
                  key={`${entry.timestamp}-${idx}`}
                  className="flex items-start gap-2 break-all"
                >
                  <span className="text-slate-600 shrink-0 select-none">
                    {entry.timestamp}
                  </span>
                  {style.tag && (
                    <span
                      className={`shrink-0 rounded border px-1 py-0 text-[9px] leading-4 font-semibold ${style.tagClass}`}
                    >
                      {style.tag}
                    </span>
                  )}
                  <span className={style.textClass}>{entry.line}</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Adoptium JRE Confirmation & Progress Modal */}
      {missingJavaMajor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl obsidian-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#38bdf8]/12 border border-[#38bdf8]/25 flex items-center justify-center text-[#38bdf8]">
                <Download
                  className={`h-5 w-5 ${installingJava ? "animate-bounce" : ""}`}
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
            <p className="text-xs text-slate-300 leading-relaxed">
              No se detectó un runtime local para Java {missingJavaMajor}. Se
              descargará la distribución oficial JRE x64 desde{" "}
              <span className="font-mono text-[#38bdf8]">api.adoptium.net</span>{" "}
              y se extraerá automáticamente sin alterar tu sistema.
            </p>

            {installingJava && javaInstallProgress && (
              <div className="rounded-xl bg-[#06080d] border border-white/[0.08] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-[#38bdf8]">
                    {javaInstallProgress.phase}
                  </span>
                  <span className="font-mono font-semibold text-white">
                    {javaInstallProgress.total > 0
                      ? `${Math.min(100, Math.round((javaInstallProgress.completed / javaInstallProgress.total) * 100))}%`
                      : "..."}
                  </span>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r from-[#38bdf8] to-[#10b981] transition-all duration-150 ${
                      javaInstallProgress.total === 0 ? "w-1/2 animate-pulse" : ""
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

            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.07]">
              <button
                type="button"
                disabled={installingJava}
                onClick={onDismissJavaModal}
                className="rounded-lg border border-white/[0.08] px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={installingJava}
                onClick={() => void onConfirmInstallJava(missingJavaMajor)}
                className="rounded-lg bg-[#10b981] hover:bg-[#059669] px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
