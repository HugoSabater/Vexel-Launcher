import { memo, useEffect, useRef, useState } from "react";
import { Check, Copy, Terminal, Trash2, X } from "lucide-react";
import type { LogLineEvent } from "../types/launcher";

export interface LogStore {
  push: (entry: LogLineEvent) => void;
  clear: () => void;
  getSnapshot: () => LogLineEvent[];
  subscribe: (listener: () => void) => () => void;
}

export function createLogStore(maxLines = 500): LogStore {
  let buffer: LogLineEvent[] = [];
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    push(entry: LogLineEvent) {
      buffer.push(entry);
      if (buffer.length > maxLines) {
        buffer = buffer.slice(buffer.length - maxLines);
      }
      notify();
    },
    clear() {
      buffer = [];
      notify();
    },
    getSnapshot() {
      return buffer.slice();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function formatLocalHms(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
    entry.line.startsWith("[GPU Preference]") ||
    entry.line.startsWith("[Java Probe]") ||
    entry.line.startsWith("[Launcher]")
  ) {
    return "text-[var(--accent-primary)]";
  }
  return "text-slate-300";
}

interface ConsoleDrawerProps {
  logStore: LogStore;
  onClose: () => void;
}

export const ConsoleDrawer = memo(function ConsoleDrawer({
  logStore,
  onClose,
}: ConsoleDrawerProps) {
  const [lines, setLines] = useState<LogLineEvent[]>(() =>
    logStore.getSnapshot(),
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    setLines(logStore.getSnapshot());
    const unsub = logStore.subscribe(() => {
      dirtyRef.current = true;
    });

    const flushTimer = window.setInterval(() => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setLines(logStore.getSnapshot());
      }
    }, 150);

    return () => {
      unsub();
      window.clearInterval(flushTimer);
    };
  }, [logStore]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleCopy = async () => {
    const report = logStore
      .getSnapshot()
      .map((l) => `[${formatLocalHms(l.timestamp_ms)}] ${l.line}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(report || "Sin líneas de log.");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <section className="h-56 shrink-0 border-t border-[#1E2534] bg-[#06080C] flex flex-col">
      <div className="h-9 px-4 bg-[#11151E] border-b border-[#1E2534] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          <span className="text-[11px] font-medium text-slate-200">
            Consola de Ejecución (Hora Local)
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            ({lines.length})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            className={`rounded px-2 py-0.5 text-[10px] font-mono border ${
              autoScroll
                ? "bg-[var(--accent-soft)] border-[var(--accent-border)] text-[var(--accent-primary)]"
                : "border-[#1E2534] text-slate-500"
            }`}
          >
            auto-scroll
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded border border-[#1E2534] px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:bg-[#171D2A]"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[var(--accent-primary)]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            copiar
          </button>
          <button
            type="button"
            onClick={() => {
              logStore.clear();
              setLines([]);
            }}
            title="Limpiar"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#171D2A]"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Ocultar (Ctrl+L)"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#171D2A]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 20;
          if (!atBottom && autoScroll) setAutoScroll(false);
        }}
        className="selectable-logs flex-1 overflow-y-auto px-4 py-2.5 font-mono text-[11px] leading-relaxed space-y-0.5"
      >
        {lines.length === 0 ? (
          <div className="text-slate-600">
            $ esperando salida del proceso javaw.exe...
          </div>
        ) : (
          lines.map((entry, idx) => (
            <div key={`${entry.timestamp_ms}-${idx}`} className="break-all">
              <span className="text-slate-600 mr-2">
                {formatLocalHms(entry.timestamp_ms)}
              </span>
              <span className={classifyLogLine(entry)}>{entry.line}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
});
