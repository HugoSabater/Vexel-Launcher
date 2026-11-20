import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  FolderOpen,
  Globe2,
  Package,
  Pencil,
  Play,
  Radio,
  Shirt,
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
} from "../types/launcher";

interface ProfileDashboardProps {
  profile: Profile;
  config: LauncherConfig;
  skinDataUrl: string | null;
  launching: boolean;
  isRunning: boolean;
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
  onPlay: () => Promise<void>;
  onStop: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onOpenSavesFolder: () => Promise<void>;
  onOpenMods: () => void;
  onOpenSettings: () => void;
  onOpenSkinTab: () => void;
  onConfirmInstallJava: (major: number) => Promise<void>;
  onDismissJavaModal: () => void;
}

const LOADER_VIGNETTE: Record<ModLoaderKind, string> = {
  vanilla:
    "radial-gradient(90% 100% at 75% 20%, rgba(16, 185, 129, 0.16) 0%, rgba(8, 10, 15, 0.85) 65%, #080A0F 100%)",
  fabric:
    "radial-gradient(90% 100% at 75% 20%, rgba(56, 189, 248, 0.16) 0%, rgba(8, 10, 15, 0.85) 65%, #080A0F 100%)",
  forge:
    "radial-gradient(90% 100% at 75% 20%, rgba(245, 158, 11, 0.15) 0%, rgba(8, 10, 15, 0.85) 65%, #080A0F 100%)",
  neo_forge:
    "radial-gradient(90% 100% at 75% 20%, rgba(249, 115, 22, 0.15) 0%, rgba(8, 10, 15, 0.85) 65%, #080A0F 100%)",
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

function formatWorldDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
  });
}

export function ProfileDashboard({
  profile,
  config,
  skinDataUrl,
  launching,
  isRunning,
  progress,
  missingJavaMajor,
  installingJava,
  javaInstallProgress,
  onListContent,
  onGetInstanceSummary,
  onUpdateUsername,
  onPlay,
  onStop,
  onOpenFolder,
  onOpenSavesFolder,
  onOpenMods,
  onOpenSettings,
  onOpenSkinTab,
  onConfirmInstallJava,
  onDismissJavaModal,
}: ProfileDashboardProps) {
  const [activeMods, setActiveMods] = useState<ContentItem[]>([]);
  const [summary, setSummary] = useState<InstanceSummary>({
    recent_worlds: [],
    latest_screenshot_data_url: null,
  });
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(config.offline_username);

  useEffect(() => {
    setNickDraft(config.offline_username);
  }, [config.offline_username]);

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
  }, [onGetInstanceSummary, onListContent, profile.id]);

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;
  const isWorking = launching || installingJava;

  const commitNick = async () => {
    setEditingNick(false);
    const trimmed = nickDraft.trim();
    if (trimmed && trimmed !== config.offline_username) {
      await onUpdateUsername(trimmed);
    } else {
      setNickDraft(config.offline_username);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#080A0F] overflow-hidden">
      {/* Main Player-First Atmospheric Stage */}
      <section className="relative flex-1 min-h-0 overflow-hidden flex items-center px-8 py-6">
        {/* Blurred Latest Screenshot Ambient Background (if present) */}
        {summary.latest_screenshot_data_url && (
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center scale-105 opacity-25 blur-xl"
            style={{
              backgroundImage: `url(${summary.latest_screenshot_data_url})`,
            }}
          />
        )}

        {/* Loader Atmospheric Vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: LOADER_VIGNETTE[profile.loader] }}
        />

        <div className="relative z-10 w-full max-w-5xl mx-auto grid grid-cols-12 items-center gap-6">
          {/* Left 7 Cols: Title, Clean Metadata Line, QuickPlay & Protagonist Action */}
          <div className="col-span-12 md:col-span-7 space-y-5">
            <div className="space-y-2">
              {profile.server_address && (
                <div className="inline-flex items-center gap-2 rounded-full bg-[#11151E]/90 border border-[#1E2534] px-3 py-1 text-[11px] font-mono text-[#38BDF8]">
                  <Radio className="h-3 w-3" />
                  <span>QuickPlay · {profile.server_address}</span>
                </div>
              )}

              <h1 className="text-4xl font-bold tracking-tight text-white leading-tight">
                {profile.name}
              </h1>

              <p className="text-sm font-mono text-slate-400">
                MC {profile.mc_version} · {LOADER_LABEL[profile.loader]} ·{" "}
                {activeMods.length}{" "}
                {activeMods.length === 1 ? "mod" : "mods"}
              </p>
            </div>

            {isWorking && progress && (
              <div className="text-xs font-mono text-[#38BDF8] truncate">
                {progress.phase}
                {progress.total > 0 ? ` (${progressPct}%)` : ""} ·{" "}
                {progress.detail}
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => void onStop()}
                  className="h-12 min-w-[180px] px-7 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.99] inline-flex items-center justify-center gap-2.5 text-sm font-bold tracking-wider text-white transition-all"
                >
                  <Square className="h-4 w-4 fill-current" />
                  DETENER
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => void onPlay()}
                  className="h-12 min-w-[180px] px-7 rounded-xl bg-[#10B981] hover:bg-[#059669] active:scale-[0.99] disabled:opacity-50 inline-flex items-center justify-center gap-2.5 text-sm font-bold tracking-wider text-slate-950 transition-all"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {launching ? "INICIANDO..." : "JUGAR"}
                </button>
              )}

              <button
                type="button"
                onClick={() => void onOpenFolder()}
                title="Abrir carpeta de la instancia"
                className="h-12 w-12 rounded-xl bg-[#11151E]/85 hover:bg-[#171D2A] border border-[#1E2534] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
              >
                <FolderOpen className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onOpenSettings}
                title="Ajustes del perfil"
                className="h-12 w-12 rounded-xl bg-[#11151E]/85 hover:bg-[#171D2A] border border-[#1E2534] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Right 5 Cols: Full-Body 3D Character directly on Atmospheric Stage */}
          <div className="hidden md:flex col-span-5 flex-col items-center justify-center">
            <SkinViewer3D
              skinUrl={skinDataUrl}
              model={config.skin_model}
              width={210}
              height={265}
            />

            <div className="mt-1 flex items-center gap-3">
              {editingNick ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void commitNick();
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    type="text"
                    autoFocus
                    value={nickDraft}
                    onChange={(e) => setNickDraft(e.target.value)}
                    onBlur={() => void commitNick()}
                    className="w-32 rounded-md bg-[#11151E] border border-[#38BDF8] px-2 py-0.5 text-xs font-mono text-white focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="text-[#10B981] hover:text-emerald-300"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingNick(true)}
                  className="group inline-flex items-center gap-1.5 text-xs font-mono font-medium text-slate-200 hover:text-white"
                >
                  <span>{config.offline_username}</span>
                  <Pencil className="h-3 w-3 text-slate-500 group-hover:text-[#38BDF8]" />
                </button>
              )}

              <span className="text-slate-700">·</span>

              <button
                type="button"
                onClick={onOpenSkinTab}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-[#38BDF8] transition-colors"
              >
                <Shirt className="h-3.5 w-3.5" />
                Cambiar skin
              </button>
            </div>
          </div>
        </div>

        {/* 2px Cyan Progress Line on Bottom Edge of Stage */}
        {isWorking && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1E2534]">
            <div
              className="h-full bg-[#38BDF8] transition-all duration-150"
              style={{ width: `${Math.max(8, progressPct)}%` }}
            />
          </div>
        )}
      </section>

      {/* Compact Player Content Bottom Strip: Recent Worlds + Active Mod Chips */}
      <footer className="shrink-0 bg-[#11151E] border-t border-[#1E2534] px-8 py-4">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent Worlds */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                <Globe2 className="h-3.5 w-3.5 text-[#10B981]" />
                Mundos Recientes
              </span>
              <button
                type="button"
                onClick={() => void onOpenSavesFolder()}
                className="text-[11px] font-mono text-slate-500 hover:text-[#38BDF8] transition-colors"
              >
                Abrir saves/
              </button>
            </div>

            {summary.recent_worlds.length === 0 ? (
              <p className="text-xs text-slate-500">
                Todavía no hay mundos guardados en esta instancia.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {summary.recent_worlds.map((world) => (
                  <button
                    key={world.folder_name}
                    type="button"
                    onClick={() => void onOpenSavesFolder()}
                    className="rounded-lg bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  >
                    <span className="text-slate-200 font-medium truncate max-w-[140px]">
                      {world.folder_name}
                    </span>
                    {world.last_modified_ms > 0 && (
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatWorldDate(world.last_modified_ms)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Active Mods (Max 5 Clean Chips) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                <Package className="h-3.5 w-3.5 text-[#38BDF8]" />
                Mods Activos
              </span>
              <button
                type="button"
                onClick={onOpenMods}
                className="inline-flex items-center gap-1 text-[11px] text-[#38BDF8] hover:underline"
              >
                Explorar / Gestionar
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            {activeMods.length === 0 ? (
              <p className="text-xs text-slate-500">
                Sin mods activos ·{" "}
                <button
                  type="button"
                  onClick={onOpenMods}
                  className="text-[#38BDF8] hover:underline"
                >
                  Instalar recomendados
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {activeMods.slice(0, 5).map((mod) => (
                  <span
                    key={mod.file_name}
                    className="rounded-md bg-[#080A0F] border border-[#1E2534] px-2.5 py-1 text-[11px] font-mono text-slate-300 truncate max-w-[160px]"
                  >
                    {mod.display_name}
                  </span>
                ))}
                {activeMods.length > 5 && (
                  <button
                    type="button"
                    onClick={onOpenMods}
                    className="rounded-md bg-[#171D2A] border border-[#1E2534] px-2 py-1 text-[11px] font-mono text-[#38BDF8]"
                  >
                    +{activeMods.length - 5}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </footer>

      {/* Adoptium JRE Confirmation & Progress Modal */}
      {missingJavaMajor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[#11151E] border border-[#1E2534] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[#080A0F] border border-[#1E2534] flex items-center justify-center text-[#38BDF8]">
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
              sin alterar tu sistema.
            </p>

            {installingJava && javaInstallProgress && (
              <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] p-3.5 space-y-2">
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

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1E2534]">
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

            <div className="flex justify-end gap-2 pt-2 border-t border-[#1E2534]">
              <button
                type="button"
                disabled={installingJava}
                onClick={onDismissJavaModal}
                className="rounded-lg border border-[#1E2534] px-3.5 py-1.5 text-xs text-slate-300 hover:bg-[#171D2A] disabled:opacity-40"
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
