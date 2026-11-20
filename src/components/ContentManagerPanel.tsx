import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Compass,
  Download,
  FileArchive,
  Package,
  RefreshCw,
  Rocket,
  Sparkles,
  Upload,
} from "lucide-react";
import type {
  ContentItem,
  ContentKind,
  CuratedRecommendation,
  LaunchProgressEvent,
  PerformancePreset,
  Profile,
} from "../types/launcher";

type ContentTab = "installed" | "recommended" | "resource_packs";

interface ContentManagerPanelProps {
  profile: Profile;
  onListContent: (
    profileId: string,
    kind: ContentKind,
  ) => Promise<ContentItem[]>;
  onGetRecommendations: (
    profileId: string,
  ) => Promise<CuratedRecommendation[]>;
  onToggleContent: (
    profileId: string,
    kind: ContentKind,
    fileName: string,
    enable: boolean,
  ) => Promise<ContentItem>;
  onImportContent: (
    profileId: string,
    kind: ContentKind,
    sourcePath: string,
  ) => Promise<ContentItem>;
  onInjectPreset: (
    profileId: string,
    preset: PerformancePreset,
    onProgress: (ev: LaunchProgressEvent) => void,
  ) => Promise<string[]>;
  onInstallItem: (
    profileId: string,
    slug: string,
    kind: ContentKind,
    onProgress: (ev: LaunchProgressEvent) => void,
  ) => Promise<string[]>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ContentManagerPanel({
  profile,
  onListContent,
  onGetRecommendations,
  onToggleContent,
  onImportContent,
  onInjectPreset,
  onInstallItem,
}: ContentManagerPanelProps) {
  const [activeTab, setActiveTab] = useState<ContentTab>("recommended");
  const [installedMods, setInstalledMods] = useState<ContentItem[]>([]);
  const [resourcePacks, setResourcePacks] = useState<ContentItem[]>([]);
  const [recommendations, setRecommendations] = useState<
    CuratedRecommendation[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mods, packs, recs] = await Promise.all([
        onListContent(profile.id, "mod"),
        onListContent(profile.id, "resource_pack"),
        onGetRecommendations(profile.id),
      ]);
      setInstalledMods(mods);
      setResourcePacks(packs);
      setRecommendations(recs);
    } finally {
      setLoading(false);
    }
  }, [onGetRecommendations, onListContent, profile.id]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleToggle = async (item: ContentItem, kind: ContentKind) => {
    const updated = await onToggleContent(
      profile.id,
      kind,
      item.file_name,
      !item.enabled,
    );
    if (kind === "mod") {
      setInstalledMods((prev) =>
        prev.map((c) => (c.file_name === item.file_name ? updated : c)),
      );
    } else {
      setResourcePacks((prev) =>
        prev.map((c) => (c.file_name === item.file_name ? updated : c)),
      );
    }
  };

  const handlePreset = async (preset: PerformancePreset) => {
    setBusySlug(preset);
    setStatusMessage(null);
    try {
      const installed = await onInjectPreset(profile.id, preset, (ev) =>
        setProgress(ev),
      );
      setStatusMessage(
        `Instalados (${installed.length} con dependencias): ${installed.join(", ")}`,
      );
      await refreshAll();
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      setBusySlug(null);
      setProgress(null);
    }
  };

  const handleInstallSingle = async (rec: CuratedRecommendation) => {
    setBusySlug(rec.slug);
    setStatusMessage(null);
    try {
      const installed = await onInstallItem(
        profile.id,
        rec.slug,
        rec.kind,
        (ev) => setProgress(ev),
      );
      setStatusMessage(`Instalado ${rec.name}: ${installed.join(", ")}`);
      await refreshAll();
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      setBusySlug(null);
      setProgress(null);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const kind: ContentKind =
      activeTab === "resource_packs" ? "resource_pack" : "mod";
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      const fileWithPath = file as File & { path?: string };
      if (fileWithPath.path) {
        await onImportContent(profile.id, kind, fileWithPath.path);
      }
    }
    await refreshAll();
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => void handleDrop(e)}
      className="h-full overflow-y-auto p-5 bg-[#080A0F]"
    >
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header & Segmented Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">
              Mods y Resource Packs
            </h1>
            <p className="text-[11px] font-mono text-slate-500">
              {profile.name} · MC {profile.mc_version} ({profile.loader})
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-[#11151E] border border-[#1E2534] p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("installed")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "installed"
                    ? "bg-[#171D2A] text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Instalados ({installedMods.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("recommended")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "recommended"
                    ? "bg-[#171D2A] text-[#38BDF8]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Recomendados
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("resource_packs")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "resource_packs"
                    ? "bg-[#171D2A] text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Resource Packs ({resourcePacks.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => void refreshAll()}
              title="Recargar"
              className="h-8 w-8 rounded-lg bg-[#11151E] border border-[#1E2534] flex items-center justify-center text-slate-400 hover:text-white"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Live Progress Strip */}
        {progress && busySlug && (
          <div className="rounded-lg bg-[#11151E] border border-[#1E2534] px-4 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[#38BDF8]">
                {progress.phase}
              </span>
              <span className="font-mono text-slate-300">
                {progress.completed}/{progress.total}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {progress.detail}
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="rounded-lg bg-[#11151E] border border-[#1E2534] px-4 py-2.5 text-xs font-mono text-slate-300">
            {statusMessage}
          </div>
        )}

        {/* TAB: RECOMENDADOS */}
        {activeTab === "recommended" && (
          <div className="space-y-4">
            {/* 2 Side-by-Side 1-Click Presets */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                      <Rocket className="h-3.5 w-3.5 text-[#10B981]" />
                      FPS Puros (Core Stack)
                    </span>
                    <span className="rounded bg-[#10B981]/12 border border-[#10B981]/30 px-1.5 py-0.5 text-[10px] font-mono text-[#10B981]">
                      5 mods + deps
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Sodium, Lithium, FerriteCore, ImmediatelyFast y C2ME con
                    resolución automática de Fabric API.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busySlug !== null || profile.loader !== "fabric"}
                  onClick={() => void handlePreset("fps_pure")}
                  className="w-full rounded-lg bg-[#10B981] hover:bg-[#059669] disabled:opacity-45 py-2 text-xs font-semibold text-slate-950 transition-colors"
                >
                  {busySlug === "fps_pure"
                    ? "Instalando FPS Puros..."
                    : profile.loader === "fabric"
                      ? "Instalar FPS Puros"
                      : "Requiere perfil Fabric"}
                </button>
              </div>

              <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                      <Compass className="h-3.5 w-3.5 text-[#38BDF8]" />
                      Horizonte Opcional (LODs)
                    </span>
                    <span className="rounded bg-[#38BDF8]/12 border border-[#38BDF8]/30 px-1.5 py-0.5 text-[10px] font-mono text-[#38BDF8]">
                      64+ chunks
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Distant Horizons independiente del pack base para renderizar
                    horizontes masivos bajo demanda.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busySlug !== null || profile.loader !== "fabric"}
                  onClick={() => void handlePreset("distant_horizons")}
                  className="w-full rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[#38BDF8]/30 disabled:opacity-45 py-2 text-xs font-semibold text-[#38BDF8] transition-colors"
                >
                  {busySlug === "distant_horizons"
                    ? "Instalando Distant Horizons..."
                    : "Añadir Distant Horizons"}
                </button>
              </div>
            </div>

            {/* Curated 2-Column Modrinth Grid */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Sparkles className="h-3.5 w-3.5 text-[#38BDF8]" />
                Selección Curada Modrinth (MC {profile.mc_version})
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {recommendations.map((rec) => {
                  const isInstalling = busySlug === rec.slug;
                  const disabledByLoader =
                    rec.kind === "mod" && profile.loader !== "fabric";

                  return (
                    <div
                      key={rec.slug}
                      className="rounded-xl bg-[#11151E] border border-[#1E2534] p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">
                            {rec.name}
                          </span>
                          <span className="rounded bg-[#080A0F] border border-[#1E2534] px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                            {rec.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2">
                          {rec.description}
                        </p>
                      </div>

                      {rec.installed ? (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#10B981]/12 border border-[#10B981]/30 px-2.5 py-1.5 text-[11px] font-mono text-[#10B981]">
                          <Check className="h-3 w-3" />
                          Instalado
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busySlug !== null || disabledByLoader}
                          onClick={() => void handleInstallSingle(rec)}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[#1E2534] disabled:opacity-45 px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
                        >
                          <Download className="h-3 w-3 text-[#38BDF8]" />
                          {isInstalling ? "..." : "Instalar"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB: INSTALADOS or RESOURCE PACKS */}
        {(activeTab === "installed" || activeTab === "resource_packs") && (
          <div className="space-y-3">
            <div
              className={`rounded-xl border border-dashed px-4 py-3 flex items-center justify-center gap-2 text-xs transition-colors ${
                dragActive
                  ? "border-[#38BDF8] bg-[#38BDF8]/10 text-[#38BDF8]"
                  : "border-[#1E2534] bg-[#11151E]/60 text-slate-400"
              }`}
            >
              <Upload className="h-3.5 w-3.5 text-[#38BDF8]" />
              <span>
                Arrastra archivos{" "}
                <code className="text-[#38BDF8]">
                  {activeTab === "resource_packs" ? ".zip" : ".jar"}
                </code>{" "}
                aquí para importarlos
              </span>
            </div>

            <div className="divide-y divide-[#1E2534] rounded-xl border border-[#1E2534] bg-[#11151E] overflow-hidden">
              {(activeTab === "installed" ? installedMods : resourcePacks)
                .length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-slate-500">
                  No hay elementos instalados todavía.
                </div>
              ) : (
                (activeTab === "installed" ? installedMods : resourcePacks).map(
                  (item) => {
                    const kind: ContentKind =
                      activeTab === "resource_packs" ? "resource_pack" : "mod";
                    return (
                      <div
                        key={item.file_name}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-[#171D2A]/60 transition-colors"
                      >
                        <div className="min-w-0 pr-4 flex items-center gap-2.5">
                          {kind === "mod" ? (
                            <Package className="h-4 w-4 text-slate-500 shrink-0" />
                          ) : (
                            <FileArchive className="h-4 w-4 text-slate-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div
                              className={`text-xs font-medium truncate ${
                                item.enabled
                                  ? "text-slate-100"
                                  : "text-slate-500 line-through"
                              }`}
                            >
                              {item.display_name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 truncate">
                              {item.file_name} · {formatSize(item.size_bytes)}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleToggle(item, kind)}
                          className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold border transition-colors ${
                            item.enabled
                              ? "bg-[#10B981]/12 text-[#10B981] border-[#10B981]/30"
                              : "bg-[#080A0F] text-slate-500 border-[#1E2534] hover:text-slate-300"
                          }`}
                        >
                          {item.enabled ? "ACTIVO" : "INACTIVO"}
                        </button>
                      </div>
                    );
                  },
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
