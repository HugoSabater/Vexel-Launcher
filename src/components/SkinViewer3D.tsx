import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, Pause, Play, Shirt } from "lucide-react";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { USERNAME_REGEX } from "../theme/accents";

interface SkinViewer3DProps {
  skinUrl: string | null;
  model: string;
  username?: string;
  paused?: boolean;
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
  paused = false,
  onUpdateUsername,
  onChangeSkinClick,
  width = 230,
  height = 305,
  className = "",
}: SkinViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(username ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(true);
  const [showOuterLayer, setShowOuterLayer] = useState(true);
  const [docHidden, setDocHidden] = useState(
    typeof document !== "undefined" ? document.hidden : false,
  );

  const rotatingRef = useRef(rotating);
  rotatingRef.current = rotating;
  const outerLayerRef = useRef(showOuterLayer);
  outerLayerRef.current = showOuterLayer;

  useEffect(() => {
    const onVisibility = () => setDocHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

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
    viewer.zoom = 0.82;
    viewer.autoRotate = rotatingRef.current;
    viewer.autoRotateSpeed = 0.45;
    viewer.animation = new IdleAnimation();
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.controls.enableRotate = true;
    viewer.playerObject.rotation.y = -0.35;
    viewer.playerObject.skin.setOuterLayerVisible(outerLayerRef.current);
    viewer.renderPaused = paused || docHidden;

    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.renderPaused = paused || docHidden;
  }, [paused, docHidden]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.autoRotate = rotating;
  }, [rotating]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.playerObject.skin.setOuterLayerVisible(showOuterLayer);
  }, [showOuterLayer]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !effectiveTexture) return;
    void viewer
      .loadSkin(effectiveTexture, { model: effectiveModel })
      .then(() => {
        if (viewerRef.current === viewer) {
          viewer.playerObject.skin.setOuterLayerVisible(outerLayerRef.current);
        }
      });
  }, [effectiveTexture, effectiveModel]);

  const commitName = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === username) {
      setEditing(false);
      setNameError(null);
      setDraft(username ?? "");
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setNameError("3-16 chars (A-Z, 0-9, _)");
      return;
    }
    setEditing(false);
    setNameError(null);
    if (onUpdateUsername) {
      try {
        await onUpdateUsername(trimmed);
      } catch {
        setDraft(username ?? "");
      }
    }
  };

  return (
    <div
      className={`group relative inline-flex flex-col items-center justify-center ${className}`}
      style={{ width, height }}
    >
      {/* Minecraft-Style Floating Nametag directly above head */}
      {username !== undefined && (
        <div className="absolute top-2 z-20 flex flex-col items-center gap-1">
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
                maxLength={16}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (nameError) setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    setNameError(null);
                    setDraft(username ?? "");
                  }
                }}
                onBlur={() => void commitName()}
                className="mc-nametag w-36 text-center bg-black/55 border-0 focus:outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (onUpdateUsername) {
                  setNameError(null);
                  setEditing(true);
                }
              }}
              title={
                onUpdateUsername ? "Clic para editar nombre offline" : undefined
              }
              className="mc-nametag hover:bg-black/50 transition-colors cursor-pointer"
            >
              {username}
            </button>
          )}
          {nameError && (
            <span className="bg-black/80 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
              {nameError}
            </span>
          )}
        </div>
      )}

      {/* Concentric Obsidian Light Pedestal under character feet */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center justify-center"
      >
        <div className="skin-pedestal h-6 w-36 rounded-full" />
        <div className="absolute h-3 w-24 rounded-full border border-[rgba(var(--accent-rgb),0.32)]" />
      </div>

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="relative z-10 cursor-grab active:cursor-grabbing"
      />

      {/* Discreet Floating Micro-Controls Dock */}
      <div className="absolute bottom-0.5 z-20 inline-flex items-center gap-1 rounded-full bg-[#0D1118]/90 border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] px-1.5 py-1 opacity-75 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setRotating((r) => !r)}
          title={rotating ? "Pausar rotación" : "Reanudar rotación"}
          className={`h-6 w-6 rounded-full flex items-center justify-center transition-colors ${
            rotating
              ? "text-[var(--accent-primary)] bg-[var(--accent-soft)]"
              : "text-slate-400 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          {rotating ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowOuterLayer((v) => !v)}
          title={
            showOuterLayer
              ? "Ocultar 2ª capa de skin"
              : "Mostrar 2ª capa de skin"
          }
          className={`h-6 w-6 rounded-full flex items-center justify-center transition-colors ${
            showOuterLayer
              ? "text-[var(--accent-primary)] bg-[var(--accent-soft)]"
              : "text-slate-400 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          <Layers className="h-3 w-3" />
        </button>

        {onChangeSkinClick && (
          <>
            <span className="h-3.5 w-px bg-white/[0.08] mx-0.5" />
            <button
              type="button"
              onClick={onChangeSkinClick}
              title="Cambiar archivo de skin (.png)"
              className="h-6 rounded-full px-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <Shirt className="h-3 w-3 text-[var(--accent-primary)]" />
              <span>Skin</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
