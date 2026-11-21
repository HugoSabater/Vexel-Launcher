import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AlertTriangle,
  Check,
  Compass,
  Cpu,
  Download,
  FileArchive,
  FolderPlus,
  Globe2,
  Package,
  RefreshCw,
  Rocket,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import type {
  ContentItem,
  ContentKind,
  LaunchProgressEvent,
  ModrinthSearchResult,
  PerformancePreset,
  Profile,
} from "../types/launcher";

type ContentTab = "installed" | "recommended" | "resource_packs";
type DiscoveryChip = "performance" | "visual" | "qol" | "world" | "resource_pack";

interface ContentManagerPanelProps {
  profile: Profile;
  onListContent: (
    profileId: string,
    kind: ContentKind,
  ) => Promise<ContentItem[]>;
  onGetDynamicRecommendations: (
    profileId: string,
    category: string,
    kind: ContentKind,
  ) => Promise<ModrinthSearchResult[]>;
  onSearchModrinth: (
    profileId: string,
    query: string,
    mcVersion: string,
    loader: string,
    kind: ContentKind,
  ) => Promise<ModrinthSearchResult[]>;
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
  onImportContentBytes: (
    profileId: string,
    kind: ContentKind,
    fileName: string,
    bytes: number[],
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

const FPS_PURE_TOKENS = [
  "sodium",
  "lithium",
  "ferrite",
  "immediatelyfast",
  "modernfix",
  "entityculling",
  "moreculling",
  "dynamic-fps",
  "badoptimizations",
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDownloads(dl: number): string {
  if (dl >= 1_000_000) return `${(dl / 1_000_000).toFixed(1)}M`;
  if (dl >= 1_000) return `${Math.round(dl / 1_000)}K`;
  return `${dl}`;
}

export function ContentManagerPanel({
  profile,
  onListContent,
  onGetDynamicRecommendations,
  onSearchModrinth,
  onToggleContent,
  onImportContent,
  onImportContentBytes,
  onInjectPreset,
  onInstallItem,
}: ContentManagerPanelProps) {
  const [activeTab, setActiveTab] = useState<ContentTab>("recommended");
  const [discoveryChip, setDiscoveryChip] =
    useState<DiscoveryChip>("performance");
  const [installedMods, setInstalledMods] = useState<ContentItem[]>([]);
  const [resourcePacks, setResourcePacks] = useState<ContentItem[]>([]);
  const [dynamicFeed, setDynamicFeed] = useState<ModrinthSearchResult[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchKind, setSearchKind] = useState<ContentKind>("mod");
  const [searchResults, setSearchResults] = useState<
    ModrinthSearchResult[] | null
  >(null);
  const [searching, setSearching] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshLocal = useCallback(async () => {
    setLoading(true);
    try {
      const [mods, packs] = await Promise.all([
        onListContent(profile.id, "mod"),
        onListContent(profile.id, "resource_pack"),
      ]);
      setInstalledMods(mods);
      setResourcePacks(packs);
    } finally {
      setLoading(false);
    }
  }, [onListContent, profile.id]);

  const refreshDynamicFeed = useCallback(async () => {
    setLoadingFeed(true);
    try {
      const kind: ContentKind =
        discoveryChip === "resource_pack" ? "resource_pack" : "mod";
      const items = await onGetDynamicRecommendations(
        profile.id,
        discoveryChip,
        kind,
      );
      setDynamicFeed(items);
    } catch {
      setDynamicFeed([]);
    } finally {
      setLoadingFeed(false);
    }
  }, [discoveryChip, onGetDynamicRecommendations, profile.id]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  useEffect(() => {
    if (activeTab === "recommended" && searchResults === null) {
      void refreshDynamicFeed();
    }
  }, [activeTab, refreshDynamicFeed, searchResults]);

  // Native Tauri v2 Drag & Drop listener
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === "over") {
            setDragActive(true);
          } else if (event.payload.type === "leave") {
            setDragActive(false);
          } else if (event.payload.type === "drop") {
            setDragActive(false);
            const paths = event.payload.paths;
            if (!paths || paths.length === 0) return;

            void (async () => {
              let imported = 0;
              for (const fullPath of paths) {
                const lower = fullPath.toLowerCase();
                if (lower.endsWith(".jar") || lower.endsWith(".jar.disabled")) {
                  await onImportContent(profile.id, "mod", fullPath);
                  imported += 1;
                } else if (
                  lower.endsWith(".zip") ||
                  lower.endsWith(".zip.disabled")
                ) {
                  await onImportContent(profile.id, "resource_pack", fullPath);
                  imported += 1;
                }
              }
              if (imported > 0) {
                setStatusMessage(
                  `Importados ${imported} archivo(s) mediante arrastrar y soltar.`,
                );
                await refreshLocal();
              }
            })();
          }
        })
        .then((fn) => {
          unlisten = fn;
        });
    } catch {
      // Browser preview fallback
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, [onImportContent, profile.id, refreshLocal]);

  const fpsPureInstalled = useMemo(() => {
    const names = installedMods.map((m) => m.file_name.toLowerCase());
    return FPS_PURE_TOKENS.every((token) =>
      names.some((n) => n.includes(token)),
    );
  }, [installedMods]);

  const distantHorizonsInstalled = useMemo(() => {
    const names = installedMods.map((m) => m.file_name.toLowerCase());
    return names.some(
      (n) => n.includes("distanthorizons") || n.includes("distant-horizons"),
    );
  }, [installedMods]);

  const c2meInstalled = useMemo(() => {
    const names = installedMods.map((m) => m.file_name.toLowerCase());
    return names.some((n) => n.includes("c2me"));
  }, [installedMods]);

  const bobbyInstalled = useMemo(() => {
    const names = installedMods.map((m) => m.file_name.toLowerCase());
    return names.some((n) => n.includes("bobby"));
  }, [installedMods]);

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

  const handleManualImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    let count = 0;
    for (const file of files) {
      const lower = file.name.toLowerCase();
      const kind: ContentKind =
        lower.endsWith(".zip") || lower.endsWith(".zip.disabled")
          ? "resource_pack"
          : "mod";
      const buffer = await file.arrayBuffer();
      await onImportContentBytes(
        profile.id,
        kind,
        file.name,
        Array.from(new Uint8Array(buffer)),
      );
      count += 1;
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (count > 0) {
      setStatusMessage(`Importados ${count} archivo(s) en la instancia.`);
      await refreshLocal();
    }
  };

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setStatusMessage(null);
    try {
      const hits = await onSearchModrinth(
        profile.id,
        q,
        profile.mc_version,
        profile.loader,
        searchKind,
      );
      setSearchResults(hits);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      setSearching(false);
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
      await refreshLocal();
      await refreshDynamicFeed();
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      setBusySlug(null);
      setProgress(null);
    }
  };

  const handleInstallSingle = async (item: ModrinthSearchResult) => {
    setBusySlug(item.slug);
    setStatusMessage(null);
    try {
      const installed = await onInstallItem(
        profile.id,
        item.slug,
        item.kind,
        (ev) => setProgress(ev),
      );
      setStatusMessage(`Instalado ${item.title}: ${installed.join(", ")}`);
      await refreshLocal();
      if (searchResults) {
        setSearchResults((prev) =>
          prev
            ? prev.map((r) =>
                r.slug === item.slug ? { ...r, installed: true } : r,
              )
            : null,
        );
      } else {
        setDynamicFeed((prev) => prev.filter((r) => r.slug !== item.slug));
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      setBusySlug(null);
      setProgress(null);
    }
  };

  const displayList = searchResults ?? dynamicFeed;

  return (
    <div className="h-full overflow-y-auto p-5 bg-[#080A0F]">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jar,.zip"
        onChange={(e) => void handleManualImport(e)}
        className="hidden"
      />

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
                    ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
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
                    ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
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
                    ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Resource Packs ({resourcePacks.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-3 rounded-lg bg-[#11151E] hover:bg-[#171D2A] border border-[#1E2534] inline-flex items-center gap-1.5 text-xs text-slate-200"
            >
              <FolderPlus className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              Importar
            </button>

            <button
              type="button"
              onClick={() => {
                void refreshLocal();
                if (activeTab === "recommended") void refreshDynamicFeed();
              }}
              title="Recargar"
              className="h-8 w-8 rounded-lg bg-[#11151E] border border-[#1E2534] flex items-center justify-center text-slate-400 hover:text-white"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading || loadingFeed ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {dragActive && (
          <div className="rounded-xl border-2 border-dashed border-[var(--accent-primary)] bg-[var(--accent-soft)] p-4 text-center text-xs font-medium text-[var(--accent-primary)]">
            Suelta tus archivos .jar o .zip aquí para instalarlos en{" "}
            {profile.name}
          </div>
        )}

        {progress && busySlug && (
          <div className="rounded-lg bg-[#11151E] border border-[#1E2534] px-4 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[var(--accent-primary)]">
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

        {/* TAB: RECOMENDADOS & SMART SEARCH */}
        {activeTab === "recommended" && (
          <div className="space-y-4">
            {/* Performance & Chunk Presets (Fabric) */}
            {profile.loader === "fabric" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fpsPureInstalled ? (
                  <div className="rounded-xl bg-[#11151E] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Stack FPS Puros instalado (9 mods)
                    </span>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("fps_pure")}
                      className="rounded-md bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      Reinstalar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                          <Rocket className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          FPS Puros (Core Estable)
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] border border-[var(--accent-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          9 mods + deps
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Sodium, Lithium, FerriteCore, ImmediatelyFast,
                        ModernFix, EntityCulling, MoreCulling, Dynamic FPS y
                        BadOptimizations.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("fps_pure")}
                      className="btn-accent w-full rounded-lg disabled:opacity-45 py-2 text-xs font-semibold transition-colors"
                    >
                      {busySlug === "fps_pure"
                        ? "Instalando FPS Puros..."
                        : "Instalar FPS Puros"}
                    </button>
                  </div>
                )}

                {c2meInstalled ? (
                  <div className="rounded-xl bg-[#11151E] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Acelerador C2ME instalado
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("installed")}
                      className="rounded-md bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      Gestionar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                          <Cpu className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Acelerador de Chunks Singleplayer
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] border border-[var(--accent-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          C2ME · Multihilo
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Generación y carga paralela de chunks en local (ideal
                        para /tp y vuelos rápidos). Experimental en snapshots.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("c2me_chunk_accel")}
                      className="w-full rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[var(--accent-border)] disabled:opacity-45 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-colors"
                    >
                      {busySlug === "c2me_chunk_accel"
                        ? "Instalando C2ME..."
                        : "Añadir C2ME (Singleplayer)"}
                    </button>
                  </div>
                )}

                {bobbyInstalled ? (
                  <div className="rounded-xl bg-[#11151E] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Bobby (Chunks Multijugador) instalado
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("installed")}
                      className="rounded-md bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      Gestionar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                          <Globe2 className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Horizonte Multijugador (Bobby)
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] border border-[var(--accent-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          Caché MP
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Guarda chunks en caché local para ver más allá del
                        límite de view-distance de servidores multijugador.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("bobby_multiplayer")}
                      className="w-full rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[var(--accent-border)] disabled:opacity-45 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-colors"
                    >
                      {busySlug === "bobby_multiplayer"
                        ? "Instalando Bobby..."
                        : "Añadir Bobby (Multijugador)"}
                    </button>
                  </div>
                )}

                {distantHorizonsInstalled ? (
                  <div className="rounded-xl bg-[#11151E] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Distant Horizons instalado
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("installed")}
                      className="rounded-md bg-[#080A0F] hover:bg-[#171D2A] border border-[#1E2534] px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      Gestionar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                          <Compass className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Horizonte Opcional (LODs)
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] border border-[var(--accent-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          64+ chunks
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Distant Horizons independiente del pack base para
                        horizontes masivos bajo demanda.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("distant_horizons")}
                      className="w-full rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[var(--accent-border)] disabled:opacity-45 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-colors"
                    >
                      {busySlug === "distant_horizons"
                        ? "Instalando Distant Horizons..."
                        : "Añadir Distant Horizons"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Smart Modrinth Search Bar */}
            <form
              onSubmit={(e) => void handleSearch(e)}
              className="flex flex-wrap items-center gap-2"
            >
              <div className="relative flex-1 min-w-[220px]">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value.trim()) setSearchResults(null);
                  }}
                  placeholder={`Buscar en Modrinth para ${profile.loader} ${profile.mc_version}...`}
                  className="w-full rounded-lg bg-[#11151E] border border-[#1E2534] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <select
                value={searchKind}
                onChange={(e) => setSearchKind(e.target.value as ContentKind)}
                className="rounded-lg bg-[#11151E] border border-[#1E2534] px-3 py-2 text-xs text-slate-200 focus:border-[var(--accent-primary)] focus:outline-none"
              >
                <option value="mod">Mods</option>
                <option value="resource_pack">Resource Packs</option>
              </select>

              <button
                type="submit"
                disabled={searching}
                className="rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[#1E2534] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {searching ? "Buscando..." : "Buscar"}
              </button>
            </form>

            {/* Dynamic Discovery Filter Chips */}
            {!searchResults && (
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: "performance", label: "Rendimiento" },
                    { id: "visual", label: "Visual y Shaders" },
                    { id: "qol", label: "Calidad de Vida" },
                    { id: "world", label: "Mundo y Aventura" },
                    { id: "resource_pack", label: "Resource Packs" },
                  ] as { id: DiscoveryChip; label: string }[]
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setDiscoveryChip(chip.id)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
                      discoveryChip === chip.id
                        ? "bg-[var(--accent-soft)] text-[var(--accent-primary)] border-[var(--accent-border)]"
                        : "bg-[#11151E] text-slate-400 border-[#1E2534] hover:text-slate-200"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            {/* Dynamic "Te podría gustar" / Search Results Grid */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                  {searchResults
                    ? `Resultados de Modrinth (${searchResults.length})`
                    : `Te podría gustar · MC ${profile.mc_version}`}
                </span>
                {searchResults && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchResults(null);
                    }}
                    className="text-[11px] text-[var(--accent-primary)] hover:underline"
                  >
                    Volver a descubrimiento
                  </button>
                )}
              </div>

              {loadingFeed && !searchResults ? (
                <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-6 text-center text-xs font-mono text-slate-500">
                  Consultando Modrinth API v2...
                </div>
              ) : displayList.length === 0 ? (
                <div className="rounded-xl bg-[#11151E] border border-[#1E2534] p-6 text-center text-xs font-mono text-slate-500">
                  No se encontraron resultados nuevos para esta categoría.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {displayList.map((item) => {
                    const isInstalling = busySlug === item.slug;
                    const disabledByLoader =
                      item.kind === "mod" && profile.loader !== "fabric";

                    return (
                      <div
                        key={`${item.kind}-${item.slug}`}
                        className="rounded-xl bg-[#11151E] border border-[#1E2534] p-3.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          {item.icon_url ? (
                            <img
                              src={item.icon_url}
                              alt={item.title}
                              className="h-9 w-9 rounded-lg object-cover border border-[#1E2534] shrink-0 bg-[#080A0F]"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-lg bg-[#080A0F] border border-[#1E2534] flex items-center justify-center text-[var(--accent-primary)] shrink-0">
                              {item.kind === "mod" ? (
                                <Package className="h-4 w-4" />
                              ) : (
                                <FileArchive className="h-4 w-4" />
                              )}
                            </div>
                          )}

                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-white truncate">
                                {item.title}
                              </span>
                              <span className="shrink-0 rounded bg-[#080A0F] border border-[#1E2534] px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                                {formatDownloads(item.downloads)} DL
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-1">
                              {item.description}
                            </p>
                            {!item.compatible && item.compatibility_note && (
                              <span className="inline-flex items-center gap-1 rounded bg-[#F59E0B]/12 border border-[#F59E0B]/35 px-1.5 py-0.5 text-[9px] font-mono text-[#F59E0B]">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {item.compatibility_note}
                              </span>
                            )}
                          </div>
                        </div>

                        {item.installed ? (
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--accent-primary)]">
                            <Check className="h-3 w-3" />
                            Instalado
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={
                              busySlug !== null ||
                              disabledByLoader ||
                              !item.compatible
                            }
                            onClick={() => void handleInstallSingle(item)}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#171D2A] hover:bg-[#1E2534] border border-[#1E2534] disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
                          >
                            <Download className="h-3 w-3 text-[var(--accent-primary)]" />
                            {isInstalling ? "..." : "Instalar"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: INSTALADOS / RESOURCE PACKS */}
        {(activeTab === "installed" || activeTab === "resource_packs") && (
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed border-[#1E2534] bg-[#11151E]/60 px-4 py-3 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Upload className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                Arrastra archivos{" "}
                <code className="text-[var(--accent-primary)]">
                  {activeTab === "resource_packs" ? ".zip" : ".jar"}
                </code>{" "}
                a esta ventana para importarlos
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[var(--accent-primary)] hover:underline font-medium"
              >
                Seleccionar archivo
              </button>
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
                          role="switch"
                          aria-checked={item.enabled}
                          onClick={() => void handleToggle(item, kind)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                            item.enabled
                              ? "bg-[var(--accent-soft)] border-[var(--accent-border)]"
                              : "bg-[#080A0F] border-[#1E2534]"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                              item.enabled
                                ? "translate-x-4 bg-[var(--accent-primary)]"
                                : "translate-x-0.5 bg-slate-500"
                            }`}
                          />
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
