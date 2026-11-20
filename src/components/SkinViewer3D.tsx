import { useEffect, useMemo, useRef } from "react";
import { IdleAnimation, SkinViewer } from "skinview3d";

interface SkinViewer3DProps {
  skinUrl: string | null;
  model: string;
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

  // Head (base 8x8 faces)
  fill(0, 0, 32, 16, "#c69674");
  fill(8, 0, 8, 8, "#3b271c"); // top hair
  fill(0, 8, 8, 3, "#3b271c"); // right hair
  fill(16, 8, 8, 3, "#3b271c"); // left hair
  fill(24, 8, 8, 6, "#3b271c"); // back hair
  fill(8, 8, 8, 2, "#3b271c"); // forehead hair
  fill(9, 12, 1, 1, "#ffffff"); // left eye white
  fill(10, 12, 1, 1, "#38bdf8"); // left iris
  fill(13, 12, 1, 1, "#38bdf8"); // right iris
  fill(14, 12, 1, 1, "#ffffff"); // right eye white
  fill(11, 13, 2, 1, "#a97758"); // nose
  fill(10, 14, 4, 1, "#7c4f3a"); // mouth

  // Torso (clean obsidian-emerald tunic)
  fill(16, 16, 24, 16, "#1e293b");
  fill(20, 20, 8, 12, "#0f766e");
  fill(22, 20, 4, 2, "#10b981");

  // Right Arm (40,16) & Left Arm (32,48)
  fill(40, 16, 16, 16, "#c69674");
  fill(40, 20, 16, 5, "#0f766e");
  fill(32, 48, 16, 16, "#c69674");
  fill(32, 52, 16, 5, "#0f766e");

  // Right Leg (0,16) & Left Leg (16,48)
  fill(0, 16, 16, 16, "#1e3a5f");
  fill(0, 28, 16, 4, "#334155");
  fill(16, 48, 16, 16, "#1e3a5f");
  fill(16, 60, 16, 4, "#334155");

  return canvas.toDataURL("image/png");
}

export function SkinViewer3D({
  skinUrl,
  model,
  width = 220,
  height = 290,
  className = "",
}: SkinViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

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
    viewer.zoom = 0.88;
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

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`cursor-grab active:cursor-grabbing ${className}`}
    />
  );
}
