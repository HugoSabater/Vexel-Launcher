import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Download,
  FolderOpen,
  Globe2,
  KeyRound,
  Package,
  Play,
  Radio,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { SkinViewer3D } from "./SkinViewer3D";
import type {
  ContentItem,
  ContentKind,
  InstanceSummary,
  LauncherConfig,
  LaunchProgressEvent,
  ModLoaderKind,
  Profile,
  WorldSummary,
} from "../types/launcher";

interface ProfileDashboardProps {
  profile: Profile;
  config: LauncherConfig;
  skinDataUrl: string | null;
  launching: boolean;
  isRunning: boolean;
  isAnyRunning: boolean;
  summaryRefreshKey: number;
  progress: LaunchProgressEvent | null;
  missingJavaMajor: number | null;
  installingJava: boolean;
  javaInstallProgress: LaunchProgressEvent | null;
  onListContent: (
    profileId: string,
    kind: ContentKind,
  ) => Promise<ContentItem[]>;
  onGetInstanceSummary: (profileId: string) => Promise<InstanceSummary>;
  onUpdateUsername: (username: string) => Promise<void>;
  onUploadSkinBytes: (bytes: number[]) => Promise<void>;
  onPlay: () => Promise<void>;
  onPlayWorld: (worldFolder: string) => Promise<void>;
  onStop: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onOpenSavesFolder: () => Promise<void>;
  onOpenMods: () => void;
  onOpenSettings: () => void;
  onConfirmInstallJava: (major: number) => Promise<void>;
  onDismissJavaModal: () => void;
}

const HERO_ACCENT_VIGNETTE =
  "radial-gradient(85% 95% at 74% 34%, rgba(var(--accent-rgb), 0.14) 0%, rgba(7, 9, 13, 0.88) 64%, #07090D 100%)";

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

function formatRelativeTimeEs(ms: number): string {
  if (!ms) return "Sin fecha";
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return "Ahora mismo";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Hace ${diffHrs} h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "Ayer";
  if (diffDays < 30) return `Hace ${diffDays} días`;
  return new Date(ms).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function getWorldModeBadge(world: WorldSummary): {
  label: string;
  classes: string;
} | null {
  if (world.hardcore) {
    return {
      label: "Hardcore",
      classes: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    };
  }
  switch (world.game_type) {
    case "survival":
      return {
        label: "Survival",
        classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
      };
    case "creative":
      return {
        label: "Creativo",
        classes: "bg-sky-500/15 text-sky-300 border-sky-500/25",
      };
    case "adventure":
      return {
        label: "Aventura",
        classes: "bg-violet-500/15 text-violet-300 border-violet-500/25",
      };
    case "spectator":
      return {
        label: "Espectador",
        classes: "bg-slate-500/15 text-slate-300 border-slate-500/25",
      };
    default:
      return null;
  }
}

function ModChipThumb({
  iconUrl,
  alt,
}: {
  iconUrl?: string | null;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [iconUrl]);

  if (!iconUrl || failed) return null;
  return (
    <img
      src={iconUrl}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-4 w-4 rounded-[3px] object-cover bg-[#07090D] shrink-0"
    />
  );
}

export function ProfileDashboard({
  profile,
  config,
  skinDataUrl,
  launching,
  isRunning,
  isAnyRunning,
  summaryRefreshKey,
  progress,
  missingJavaMajor,
  installingJava,
  javaInstallProgress,
  onListContent,
  onGetInstanceSummary,
  onUpdateUsername,
  onUploadSkinBytes,
  onPlay,
  onPlayWorld,
  onStop,
  onOpenFolder,
  onOpenSavesFolder,
  onOpenMods,
  onOpenSettings,
  onConfirmInstallJava,
  onDismissJavaModal,
}: ProfileDashboardProps) {
  const [activeMods, setActiveMods] = useState<ContentItem[]>([]);
  const [summary, setSummary] = useState<InstanceSummary>({
    recent_worlds: [],
    latest_screenshot_data_url: null,
  });
  const [copiedSeedFolder, setCopiedSeedFolder] = useState<string | null>(null);
  const [mismatchWorld, setMismatchWorld] = useState<WorldSummary | null>(null);
  const quickSkinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      onListContent(profile.id, "mod"),
      onGetInstanceSummary(profile.id),
    ])
      .then(([mods, instSummary]) => {
        if (!cancelled) {
          setActiveMods(mods.filter((m) => m.enabled));
          setSummary(instSummary);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveMods([]);
          setSummary({ recent_worlds: [], latest_screenshot_data_url: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onGetInstanceSummary, onListContent, profile.id, summaryRefreshKey]);

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;
  const isWorking = launching || installingJava;
  const unsupportedLoader =
    profile.loader === "forge" || profile.loader === "neo_forge";

  const handleQuickSkinPick = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await onUploadSkinBytes(Array.from(new Uint8Array(buffer)));
    } catch {
      // Error surfaced via global banner in App.tsx
    } finally {
      if (quickSkinInputRef.current) quickSkinInputRef.current.value = "";
    }
  };

  const handleCopySeed = async (
    event: React.MouseEvent,
    folderName: string,
    seed: string,
  ) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(seed);
      setCopiedSeedFolder(folderName);
      window.setTimeout(() => {
        setCopiedSeedFolder((curr) => (curr === folderName ? null : curr));
      }, 1500);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleWorldClick = (world: WorldSummary) => {
    const hasMismatch =
      Boolean(world.mc_version) && world.mc_version !== profile.mc_version;
    if (hasMismatch) {
      setMismatchWorld(world);
      return;
    }
    void onPlayWorld(world.folder_name);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#07090D] overflow-hidden">
      <input
        ref={quickSkinInputRef}
        type="file"
        accept=".png,image/png"
        onChange={(e) => void handleQuickSkinPick(e)}
        className="hidden"
      />

      {/* Main Player-First Atmospheric Stage */}
      <section className="relative flex-1 min-h-0 overflow-hidden flex items-center px-8 py-6">
        {summary.latest_screenshot_data_url && (
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center scale-105 opacity-20 blur-2xl"
            style={{
              backgroundImage: `url(${summary.latest_screenshot_data_url})`,
            }}
          />
        )}

        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: HERO_ACCENT_VIGNETTE }}
        />

        <div className="relative z-10 w-full max-w-5xl mx-auto grid grid-cols-12 items-center gap-6">
          {/* Left 7 Cols */}
          <div className="col-span-12 md:col-span-7 space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {profile.is_default && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-primary)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
                    Instancia predeterminada
                  </span>
                )}
                {profile.server_address && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] px-2.5 py-0.5 text-[11px] font-mono text-slate-300">
                    <Radio className="h-3 w-3 text-[var(--accent-primary)]" />
                    Conexión directa · {profile.server_address}
                  </span>
                )}
              </div>

              <h1 className="text-[2.125rem] font-bold tracking-[-0.025em] text-white leading-[1.12]">
                {profile.name}
              </h1>

              {/* Metadata Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] font-mono text-slate-200">
                  Minecraft {profile.mc_version}
                </span>
                <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] font-mono text-slate-300">
                  {LOADER_LABEL[profile.loader]}
                </span>
                <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] font-mono text-slate-300">
                  {activeMods.length}{" "}
                  {activeMods.length === 1 ? "mod activo" : "mods activos"}
                </span>
                <span className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] font-mono text-slate-400">
                  {(profile.ram_mb / 1024).toFixed(1)} GB RAM
                </span>
              </div>
            </div>

            {unsupportedLoader && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2 text-xs text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
                <span>
                  {LOADER_LABEL[profile.loader]} estará disponible próximamente.
                  Cambia el tipo de instalación a Vanilla o Fabric en Ajustes
                  para jugar.
                </span>
              </div>
            )}

            {/* Primary CTA + Grouped Utility Toolbar */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3">
                {isRunning ? (
                  <button
                    type="button"
                    onClick={() => void onStop()}
                    className="h-12 min-w-[196px] px-7 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.985] shadow-[0_10px_28px_-8px_rgba(244,63,94,0.55)] inline-flex items-center justify-center gap-2.5 text-[13px] font-bold tracking-[0.06em] text-white transition-all"
                  >
                    <Square className="h-4 w-4 fill-current" />
                    DETENER
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isWorking || unsupportedLoader}
                    onClick={() => void onPlay()}
                    className="btn-play-hero h-12 min-w-[196px] px-7 rounded-xl disabled:opacity-50 inline-flex items-center justify-center gap-2.5 text-[13px] font-bold tracking-[0.06em]"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {unsupportedLoader
                      ? "PRÓXIMAMENTE"
                      : launching
                        ? "INICIANDO..."
                        : "JUGAR"}
                  </button>
                )}

                <div className="inline-flex items-center rounded-xl bg-[#121722]/90 border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] p-1 gap-0.5">
                  <button
                    type="button"
                    onClick={() => void onOpenFolder()}
                    title="Abrir carpeta de la instancia"
                    className="h-10 w-10 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={onOpenSettings}
                    title="Ajustes de la instancia"
                    className="h-10 w-10 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Prominent Compact Launch Progress Bar */}
              {isWorking && progress && (
                <div className="max-w-sm rounded-xl bg-[#0D1118]/90 border border-white/[0.08] px-3.5 py-2.5 space-y-2 shadow-lg">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-100 truncate">
                      {progress.phase}
                    </span>
                    <span className="font-mono font-semibold text-[var(--accent-primary)] shrink-0">
                      {progress.total > 0 ? `${progressPct}%` : "..."}
                    </span>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={`h-full rounded-full bg-[var(--accent-primary)] transition-all duration-150 ${
                        progress.total === 0 ? "w-1/2 animate-pulse" : ""
                      }`}
                      style={
                        progress.total > 0
                          ? { width: `${Math.max(6, progressPct)}%` }
                          : undefined
                      }
                    />
                  </div>

                  {progress.detail && (
                    <div className="text-[11px] text-slate-400 truncate">
                      {progress.detail}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 Cols: 3D Character + Floating Micro-Controls */}
          <div className="hidden md:flex col-span-5 items-center justify-center">
            <SkinViewer3D
              skinUrl={skinDataUrl}
              model={config.skin_model}
              username={config.offline_username}
              paused={isAnyRunning}
              onUpdateUsername={onUpdateUsername}
              onChangeSkinClick={() => quickSkinInputRef.current?.click()}
              width={235}
              height={310}
            />
          </div>
        </div>
      </section>

      {/* Bottom Surface: Rich Recent Worlds + Active Mods */}
      <footer className="shrink-0 bg-[#0D1118] border-t border-white/[0.06] px-8 py-4">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 8 Cols: Rich Recent Worlds */}
          <div className="lg:col-span-8 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                <Globe2 className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                Mundos Recientes
                {summary.recent_worlds.length > 0 && (
                  <span className="font-mono text-slate-500">
                    · {summary.recent_worlds.length}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void onOpenSavesFolder()}
                className="text-[11px] text-slate-400 hover:text-[var(--accent-primary)] transition-colors"
              >
                Carpeta de mundos
              </button>
            </div>

            {summary.recent_worlds.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-dashed border-white/[0.07] px-4 py-3 text-xs text-slate-500">
                Todavía no hay mundos guardados en esta instancia.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {summary.recent_worlds.map((world) => {
                  const modeBadge = getWorldModeBadge(world);
                  const versionMismatch =
                    Boolean(world.mc_version) &&
                    world.mc_version !== profile.mc_version;
                  const canLaunchWorld =
                    !isWorking && !isRunning && !unsupportedLoader;
                  const isSeedCopied = copiedSeedFolder === world.folder_name;

                  return (
                    <div
                      key={world.folder_name}
                      role="button"
                      tabIndex={canLaunchWorld ? 0 : -1}
                      aria-disabled={!canLaunchWorld}
                      onClick={() => {
                        if (canLaunchWorld) {
                          handleWorldClick(world);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          canLaunchWorld &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          handleWorldClick(world);
                        }
                      }}
                      title={`Entrar directamente a "${world.level_name}"`}
                      className={`group forge-card-interactive rounded-xl p-3 flex flex-col justify-between gap-2.5 text-left ${
                        canLaunchWorld
                          ? "cursor-pointer"
                          : "opacity-50 pointer-events-none"
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {world.icon_data_url ? (
                          <img
                            src={world.icon_data_url}
                            alt={world.level_name}
                            className="h-10 w-10 rounded-lg object-cover pixelated shrink-0 bg-[#07090D] border border-white/[0.08]"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-[#07090D] border border-white/[0.06] flex items-center justify-center text-slate-500 group-hover:text-[var(--accent-primary)] shrink-0 transition-colors">
                            <Globe2 className="h-4 w-4" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[13px] font-semibold text-slate-100 group-hover:text-white truncate">
                              {world.level_name}
                            </span>
                            <Play className="h-3 w-3 text-[var(--accent-primary)] fill-current shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>

                          <div className="flex flex-wrap items-center gap-1">
                            {modeBadge && (
                              <span
                                className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-medium ${modeBadge.classes}`}
                              >
                                {modeBadge.label}
                              </span>
                            )}
                            {versionMismatch && world.mc_version && (
                              <span
                                title={`Jugado en Minecraft ${world.mc_version} (instancia actual: ${profile.mc_version})`}
                                className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 border border-amber-500/35 px-1.5 py-[1px] text-[10px] font-mono text-amber-300"
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {world.mc_version}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-white/[0.04]">
                        <span className="text-[11px] font-mono text-slate-500 truncate">
                          {formatRelativeTimeEs(world.last_played_ms)}
                        </span>

                        {world.seed !== null && (
                          <button
                            type="button"
                            onClick={(e) =>
                              void handleCopySeed(
                                e,
                                world.folder_name,
                                world.seed as string,
                              )
                            }
                            title={`Copiar semilla: ${world.seed}`}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:text-[var(--accent-primary)] hover:bg-white/[0.05] transition-colors shrink-0"
                          >
                            {isSeedCopied ? (
                              <>
                                <Check className="h-2.5 w-2.5 text-[var(--accent-primary)]" />
                                <span className="text-[var(--accent-primary)]">
                                  Copiada
                                </span>
                              </>
                            ) : (
                              <>
                                <KeyRound className="h-2.5 w-2.5" />
                                <span>Semilla</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right 4 Cols: Active Mods */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                <Package className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                Mods Activos
              </span>
              <button
                type="button"
                onClick={onOpenMods}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-primary)] hover:underline"
              >
                Gestionar
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            {activeMods.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] border border-dashed border-white/[0.07] px-4 py-3 text-xs text-slate-500">
                Sin mods activos ·{" "}
                <button
                  type="button"
                  onClick={onOpenMods}
                  className="text-[var(--accent-primary)] hover:underline font-medium"
                >
                  {profile.loader === "fabric"
                    ? "Instalar Pack de FPS"
                    : "Explorar contenido"}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {activeMods.slice(0, 6).map((mod) => (
                  <span
                    key={mod.file_name}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#121722] border border-white/[0.06] px-2 py-1 text-[11px] font-mono text-slate-300 max-w-[165px]"
                  >
                    <ModChipThumb
                      iconUrl={mod.icon_url}
                      alt={mod.display_name}
                    />
                    <span className="truncate">{mod.display_name}</span>
                  </span>
                ))}
                {activeMods.length > 6 && (
                  <button
                    type="button"
                    onClick={onOpenMods}
                    className="rounded-md bg-[var(--accent-soft)] hover:brightness-110 px-2.5 py-1 text-[11px] font-mono font-medium text-[var(--accent-primary)] transition-all"
                  >
                    +{activeMods.length - 6} más
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </footer>

      {/* World Version Mismatch Confirmation Modal */}
      {mismatchWorld && (
        <div
          onClick={() => setMismatchWorld(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl forge-card p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <h3 className="text-[14px] font-semibold text-white">
                  Versión de Minecraft diferente
                </h3>
                <p className="text-xs text-slate-400">
                  {mismatchWorld.level_name} ·{" "}
                  <span className="font-mono text-amber-300">
                    {mismatchWorld.mc_version}
                  </span>{" "}
                  →{" "}
                  <span className="font-mono text-white">
                    {profile.mc_version}
                  </span>
                </p>
              </div>
            </div>

            <p className="text-[13px] text-slate-300 leading-relaxed">
              Este mundo se jugó por última vez en Minecraft{" "}
              <span className="font-mono font-semibold text-amber-300">
                {mismatchWorld.mc_version}
              </span>
              , pero esta instancia usa{" "}
              <span className="font-mono font-semibold text-white">
                {profile.mc_version}
              </span>
              . Abrirlo en otra versión puede convertirlo o dañarlo de forma
              irreversible.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setMismatchWorld(null)}
                className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const folder = mismatchWorld.folder_name;
                  setMismatchWorld(null);
                  void onPlayWorld(folder);
                }}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-xs font-semibold text-slate-950 transition-colors"
              >
                Abrir de todas formas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Friendly Java Required & Download Modal */}
      {missingJavaMajor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl forge-card p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent-primary)]">
                <Download
                  className={`h-4 w-4 ${installingJava ? "animate-bounce" : ""}`}
                />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-white">
                  Minecraft {profile.mc_version} necesita Java{" "}
                  {missingJavaMajor}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Descarga automática e independiente
                </p>
              </div>
            </div>

            <p className="text-[13px] text-slate-400 leading-relaxed">
              Para abrir esta versión del juego hace falta Java{" "}
              {missingJavaMajor}. Lo descargaremos automáticamente dentro de
              Vexel Launcher sin tocar tu PC ni instalar programas externos.
            </p>

            {installingJava && javaInstallProgress && (
              <div className="rounded-lg bg-[#07090D] border border-white/[0.06] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-[var(--accent-primary)]">
                    {javaInstallProgress.phase}
                  </span>
                  <span className="font-mono font-semibold text-white">
                    {javaInstallProgress.total > 0
                      ? `${Math.min(100, Math.round((javaInstallProgress.completed / javaInstallProgress.total) * 100))}%`
                      : "..."}
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={`h-full rounded-full bg-[var(--accent-primary)] transition-all duration-150 ${
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

            <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.06]">
              <button
                type="button"
                disabled={installingJava}
                onClick={onDismissJavaModal}
                className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] px-3.5 py-1.5 text-xs font-medium text-slate-300 disabled:opacity-40 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={installingJava}
                onClick={() => void onConfirmInstallJava(missingJavaMajor)}
                className="btn-accent rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {installingJava
                  ? (javaInstallProgress?.phase ?? "Instalando Java...")
                  : `Descargar Java ${missingJavaMajor}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
