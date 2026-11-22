import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, WifiOff } from "lucide-react";
import type { MinecraftVersionEntry } from "../types/launcher";

interface VersionPickerProps {
  value: string;
  versions: MinecraftVersionEntry[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (nextVersion: string) => void;
  className?: string;
}

function formatVersionTypeTag(versionType: string): string | null {
  switch (versionType) {
    case "snapshot":
      return "Prueba";
    case "old_beta":
      return "Beta";
    case "old_alpha":
      return "Alpha";
    default:
      return null;
  }
}

export function VersionPicker({
  value,
  versions,
  loading = false,
  disabled = false,
  onChange,
  className = "",
}: VersionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [manualDraft, setManualDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setManualDraft(value);
  }, [value]);

  // If the current selected version is a snapshot, auto-enable snapshots when opening
  const selectedMeta = useMemo(
    () => versions.find((v) => v.id === value) ?? null,
    [versions, value],
  );

  useEffect(() => {
    if (!open) return;
    if (selectedMeta && selectedMeta.version_type !== "release") {
      setShowSnapshots(true);
    }
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, selectedMeta]);

  const filteredVersions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return versions
      .filter((v) => {
        if (!showSnapshots && v.version_type !== "release") {
          return false;
        }
        if (!q) return true;
        return v.id.toLowerCase().includes(q);
      })
      .slice(0, 120);
  }, [versions, showSnapshots, query]);

  const isOfflineEmpty = !loading && versions.length === 0;

  if (isOfflineEmpty) {
    return (
      <div className={`space-y-1 ${className}`}>
        <input
          type="text"
          disabled={disabled}
          value={manualDraft}
          onChange={(e) => setManualDraft(e.target.value)}
          onBlur={() => {
            const trimmed = manualDraft.trim();
            if (trimmed && trimmed !== value) {
              onChange(trimmed);
            } else {
              setManualDraft(value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const trimmed = manualDraft.trim();
              if (trimmed && trimmed !== value) {
                onChange(trimmed);
              }
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder="1.21.4"
          className="w-full rounded-lg border border-white/[0.08] bg-[#07090D] px-3 py-1.5 text-[13px] font-mono text-white placeholder:text-slate-600 focus:border-[var(--accent-primary)] focus:outline-none disabled:opacity-50 transition-colors"
        />
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
          <WifiOff className="h-2.5 w-2.5" />
          Sin conexión: escribe la versión
        </span>
      </div>
    );
  }

  const selectedTag = selectedMeta
    ? formatVersionTypeTag(selectedMeta.version_type)
    : null;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        className="w-full rounded-lg border border-white/[0.08] bg-[#07090D] hover:border-white/[0.16] px-3 py-1.5 text-[13px] text-white flex items-center justify-between gap-2 focus:border-[var(--accent-primary)] focus:outline-none disabled:opacity-50 transition-colors"
      >
        <span className="inline-flex items-center gap-1.5 truncate font-mono">
          <span className="truncate">{value || "Elegir versión"}</span>
          {selectedTag && (
            <span className="rounded bg-amber-500/15 px-1 py-[1px] text-[9px] font-sans font-medium text-amber-300">
              {selectedTag}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 min-w-[240px] rounded-xl forge-card shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-white/[0.06] space-y-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredVersions.length > 0) {
                    e.preventDefault();
                    onChange(filteredVersions[0].id);
                    setOpen(false);
                  }
                }}
                placeholder="Buscar versión (ej. 1.21.4)..."
                className="w-full rounded-md bg-[#07090D] border border-white/[0.08] pl-8 pr-2.5 py-1.5 text-xs font-mono text-white placeholder:text-slate-500 focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 px-1 text-[11px] text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors">
              <input
                type="checkbox"
                checked={showSnapshots}
                onChange={(e) => setShowSnapshots(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[var(--accent-primary)]"
              />
              <span>Mostrar versiones de prueba (snapshots)</span>
            </label>
          </div>

          <div className="max-h-52 overflow-y-auto p-1 space-y-0.5">
            {loading && versions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500">
                Cargando versiones de Minecraft...
              </div>
            ) : filteredVersions.length === 0 ? (
              <div className="px-3 py-3 text-center space-y-2">
                <p className="text-xs text-slate-500">
                  No se encontró &ldquo;{query.trim()}&rdquo;
                </p>
                {query.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(query.trim());
                      setOpen(false);
                    }}
                    className="rounded-md bg-white/[0.06] hover:bg-white/[0.1] px-2.5 py-1 text-[11px] font-mono text-slate-200 transition-colors"
                  >
                    Usar &ldquo;{query.trim()}&rdquo; igualmente
                  </button>
                )}
              </div>
            ) : (
              filteredVersions.map((ver) => {
                const isSelected = ver.id === value;
                const tag = formatVersionTypeTag(ver.version_type);
                return (
                  <button
                    key={ver.id}
                    type="button"
                    onClick={() => {
                      onChange(ver.id);
                      setOpen(false);
                    }}
                    className={`w-full rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                        : "text-slate-200 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className="font-mono font-medium truncate">
                        {ver.id}
                      </span>
                      {tag && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-[1px] text-[10px] font-medium text-amber-300">
                          {tag}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
