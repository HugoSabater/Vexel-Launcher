import { useCallback, useRef, useState } from "react";

interface MinecraftSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue?: (val: number) => string;
  onChange: (next: number) => void;
  disabled?: boolean;
  className?: string;
}

export function MinecraftSlider({
  label,
  value,
  min,
  max,
  step = 1,
  formatValue,
  onChange,
  disabled = false,
  className = "",
}: MinecraftSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const clamped = Math.min(max, Math.max(min, value));
  const span = Math.max(1, max - min);
  const pct = ((clamped - min) / span) * 100;

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || disabled) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      const next = Math.min(max, Math.max(min, snapped));
      if (next !== value) {
        onChange(next);
      }
    },
    [disabled, max, min, onChange, step, value],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || editing) return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || editing) return;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(Math.min(max, clamped + step));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(Math.max(min, clamped - step));
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
  };

  const openInlineEdit = (event: React.MouseEvent) => {
    if (disabled) return;
    event.stopPropagation();
    setDraft(String(clamped));
    setEditing(true);
  };

  const commitInlineEdit = () => {
    const parsed = Number.parseInt(draft.trim(), 10);
    if (Number.isFinite(parsed)) {
      const snapped = Math.round(parsed / step) * step;
      onChange(Math.min(max, Math.max(min, snapped)));
    }
    setEditing(false);
  };

  const formattedValue = formatValue ? formatValue(clamped) : `${clamped}%`;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamped}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDoubleClick={openInlineEdit}
      title="Arrastra para ajustar (doble clic para escribir un valor exacto)"
      className={`group relative h-10 w-full select-none overflow-hidden rounded-lg border border-white/[0.08] bg-[#0D1118] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors focus:outline-none focus:border-[var(--accent-primary)] ${
        disabled
          ? "opacity-45 cursor-not-allowed"
          : "cursor-ew-resize hover:border-white/[0.16]"
      } ${className}`}
    >
      {/* Translucent accent progress fill */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--accent-soft)] transition-[width] duration-75"
        style={{ width: `${pct}%` }}
      />

      {/* Crisp Minecraft-style vertical handle */}
      <div
        className="pointer-events-none absolute inset-y-0.5 w-2 -ml-1 rounded-[3px] border border-white/25 bg-[var(--accent-primary)] shadow-[0_0_10px_rgba(var(--accent-rgb),0.45)] transition-[left] duration-75"
        style={{ left: `clamp(5px, ${pct}%, calc(100% - 5px))` }}
      />

      {/* Centered label + value or inline numeric input */}
      <div className="relative z-10 flex h-full w-full items-center justify-center px-3">
        {editing ? (
          <div
            className="flex items-center gap-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-xs font-medium text-slate-300">{label}:</span>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitInlineEdit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitInlineEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              className="w-16 rounded border border-[var(--accent-primary)] bg-[#07090D] px-1.5 py-0.5 text-center font-mono text-xs text-white focus:outline-none"
            />
          </div>
        ) : (
          <span className="truncate text-xs font-medium text-slate-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {label}:{" "}
            <span className="font-mono font-semibold text-white">
              {formattedValue}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
