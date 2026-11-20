import { useEffect, useMemo, useRef, useState } from "react";
import { Shirt } from "lucide-react";
import { IdleAnimation, SkinViewer } from "skinview3d";

interface SkinViewer3DProps {
  skinUrl: string | null;
  model: string;
  username?: string;
  onUpdateUsername?: (nextName: string) => Promise<void>;
  onChangeSkinClick?: () => void;
  width?: number;
  height?: number;
  className?: string;
}

function buildDefaultSteveTexture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const fill = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  fill(0, 0, 32, 16, "#c69674");
  fill(8, 0, 8, 8, "#3b271c");
  fill(0, 8, 8, 3, "#3b271c");
  fill(16, 8, 8, 3, "#3b271c");
  fill(24, 8, 8, 6, "#3b271c");
  fill(8, 8, 8, 2, "#3b271c");
  fill(9, 12, 1, 1, "#ffffff");
  fill(10, 12, 1, 1, "#38bdf8");
  fill(13, 12, 1, 1, "#38bdf8");
  fill(14, 12, 1, 1, "#ffffff");
  fill(11, 13, 2, 1, "#a97758");
  fill(10, 14, 4, 1, "#7c4f3a");

  fill(16, 16, 24, 16, "#1e293b");
  fill(20, 20, 8, 12, "#0f766e");
  fill(22, 20, 4, 2, "#10b981");

  fill(40, 16, 16, 16, "#c69674");
  fill(40, 20, 16, 5, "#0f766e");
  fill(32, 48, 16, 16, "#c69674");
  fill(32, 52, 16, 5, "#0f766e");

  fill(0, 16, 16, 16, "#1e3a5f");
  fill(0, 28, 16, 4, "#334155");
  fill(16, 48, 16, 16, "#1e3a5f");
  fill(16, 60, 16, 4, "#334155");

  return canvas.toDataURL("image/png");
}

export function SkinViewer3D({
  skinUrl,
  model,
  username,
  onUpdateUsername,
  onChangeSkinClick,
  width = 220,
  height = 285,
  className = "",
}: SkinViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(username ?? "");

  useEffect(() => {
    setDraft(username ?? "");
  }, [username]);

  const fallbackTexture = useMemo(() => buildDefaultSteveTexture(), []);
  const effectiveTexture = skinUrl ?? fallbackTexture;
  const effectiveModel = model === "slim" ? "slim" : "default";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewer = new SkinViewer({
      canvas,
      width,
      height,
      skin: effectiveTexture,
      model: effectiveModel,
    });

    viewer.background = null;
    viewer.fov = 42;
    viewer.zoom = 0.84;
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.45;
    viewer.animation = new IdleAnimation();
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.controls.enableRotate = true;
    viewer.playerObject.rotation.y = -0.35;

    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !effectiveTexture) return;
    void viewer.loadSkin(effectiveTexture, { model: effectiveModel });
  }, [effectiveTexture, effectiveModel]);

  const commitName = async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== username && onUpdateUsername) {
      await onUpdateUsername(trimmed);
    } else {
      setDraft(username ?? "");
    }
  };

  return (
    <div
      className={`group relative inline-flex flex-col items-center justify-center ${className}`}
      style={{ width, height }}
    >
      {/* Minecraft-Style Floating Nametag directly above head */}
      {username !== undefined && (
        <div className="absolute top-1 z-20">
          {editing && onUpdateUsername ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void commitName();
              }}
            >
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commitName()}
                className="w-32 rounded bg-black/80 border border-[var(--accent-primary)] px-2 py-0.5 text-center text-xs font-mono text-white focus:outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (onUpdateUsername) setEditing(true);
              }}
              title={onUpdateUsername ? "Clic para editar nombre offline" : undefined}
              className="rounded bg-black/60 hover:bg-black/80 px-2.5 py-0.5 text-xs font-mono text-slate-100 tracking-wide transition-colors"
            >
              {username}
            </button>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="cursor-grab active:cursor-grabbing"
      />

      {/* Discreet Hover Pill at Base for Changing Skin */}
      {onChangeSkinClick && (
        <button
          type="button"
          onClick={onChangeSkinClick}
          className="absolute bottom-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1.5 rounded-full bg-black/70 hover:bg-black/90 border border-white/10 px-3 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-sm"
        >
          <Shirt className="h-3 w-3 text-[var(--accent-primary)]" />
          Cambiar skin
        </button>
      )}
    </div>
  );
}
