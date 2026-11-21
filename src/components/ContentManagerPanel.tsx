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
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  ContentItem,
  ContentKind,
  LaunchProgressEvent,
  ModrinthSearchResult,
  ModrinthSort,
  PerformancePreset,
  Profile,
} from "../types/launcher";

type ContentTab = "installed" | "recommended" | "resource_packs" | "shaders";
type DiscoveryChip =
  | "performance"
  | "visual"
  | "qol"
  | "world"
  | "resource_pack"
  | "shader";
type LocalSort = "name" | "size" | "enabled";

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
    offset?: number,
    sort?: ModrinthSort,
  ) => Promise<ModrinthSearchResult[]>;
  onSearchModrinth: (
    profileId: string,
    query: string,
    mcVersion: string,
    loader: string,
    kind: ContentKind,
    offset?: number,
    sort?: ModrinthSort,
  ) => Promise<ModrinthSearchResult[]>;
  onToggleContent: (
    profileId: string,
    kind: ContentKind,
    fileName: string,
    enable: boolean,
  ) => Promise<ContentItem>;
  onDeleteContent: (
    profileId: string,
    kind: ContentKind,
    fileName: string,
  ) => Promise<void>;
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

const FPS_PURE_SLUGS = [
  "sodium",
  "lithium",
  "ferrite-core",
  "immediatelyfast",
  "modernfix",
  "entityculling",
  "moreculling",
  "dynamic-fps",
  "badoptimizations",
];

function normalizeId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasInstalledSlug(items: ContentItem[], slug: string): boolean {
  const normSlug = normalizeId(slug);
  const normBase = normalizeId(
    slug.replace(/-(fabric|forge|neoforge)$/i, ""),
  );
  return items.some((item) => {
    if (item.slug) {
      const s = normalizeId(item.slug);
      if (s === normSlug || s === normBase) return true;
    }
    if (item.mod_id) {
      const m = normalizeId(item.mod_id);
      if (m === normSlug || m === normBase) return true;
      return false;
    }
    if (item.slug || item.project_id) return false;
    const f = item.file_name.toLowerCase();
    return (
      f.startsWith(`${slug.toLowerCase()}-`) ||
      f.startsWith(`${normBase}-`) ||
      f.startsWith(`${normBase}_`)
    );
  });
}

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
  onDeleteContent,
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
  const [shaderPacks, setShaderPacks] = useState<ContentItem[]>([]);

  const [dynamicFeed, setDynamicFeed] = useState<ModrinthSearchResult[]>([]);
  const [feedOffset, setFeedOffset] = useState(0);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [loadingFeed, setLoadingFeed] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchKind, setSearchKind] = useState<ContentKind>("mod");
  const [modrinthSort, setModrinthSort] = useState<ModrinthSort>("downloads");
  const [searchResults, setSearchResults] = useState<
    ModrinthSearchResult[] | null
  >(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searching, setSearching] = useState(false);

  const [localQuery, setLocalQuery] = useState("");
  const [localSort, setLocalSort] = useState<LocalSort>("name");
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(
    null,
  );

  const [loading, setLoading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTabRef = useRef<ContentTab>(activeTab);
  activeTabRef.current = activeTab;
  const localReqRef = useRef(0);
  const feedReqRef = useRef(0);
  const searchReqRef = useRef(0);

  // Reset search/transient state cleanly when switching profile
  useEffect(() => {
    searchReqRef.current += 1;
    setSearchQuery("");
    setSearchResults(null);
    setSearchOffset(0);
    setSearchHasMore(false);
    setConfirmDeleteFile(null);
    setStatusMessage(null);
    setFeedOffset(0);
  }, [profile.id]);

  const refreshLocal = useCallback(async () => {
    const reqId = ++localReqRef.current;
    setLoading(true);
    try {
      const [mods, packs, shaders] = await Promise.all([
        onListContent(profile.id, "mod"),
        onListContent(profile.id, "resource_pack"),
        onListContent(profile.id, "shader"),
      ]);
      if (reqId !== localReqRef.current) return;
      setInstalledMods(mods);
      setResourcePacks(packs);
      setShaderPacks(shaders);
    } catch (err) {
      if (reqId !== localReqRef.current) return;
      setStatusMessage(
        err instanceof Error ? err.message : "Error cargando contenido local",
      );
    } finally {
      if (reqId === localReqRef.current) {
        setLoading(false);
      }
    }
  }, [onListContent, profile.id]);

  const discoveryKind: ContentKind =
    discoveryChip === "resource_pack"
      ? "resource_pack"
      : discoveryChip === "shader"
        ? "shader"
        : "mod";

  const fetchFeedPage = useCallback(
    async (offset: number, append: boolean, sort: ModrinthSort) => {
      const reqId = ++feedReqRef.current;
      setLoadingFeed(true);
      try {
        const items = await onGetDynamicRecommendations(
          profile.id,
          discoveryChip,
          discoveryKind,
          offset,
          sort,
        );
        if (reqId !== feedReqRef.current) return;
        if (append) {
          setDynamicFeed((prev) => {
            const seen = new Set(prev.map((p) => `${p.kind}:${p.slug}`));
            const merged = [...prev];
            for (const item of items) {
              if (!seen.has(`${item.kind}:${item.slug}`)) {
                merged.push(item);
              }
            }
            return merged;
          });
        } else {
          setDynamicFeed(items);
        }
        setFeedOffset(offset);
        setFeedHasMore(items.length >= 10);
      } catch {
        if (reqId !== feedReqRef.current) return;
        if (!append) setDynamicFeed([]);
        setFeedHasMore(false);
      } finally {
        if (reqId === feedReqRef.current) {
          setLoadingFeed(false);
        }
      }
    },
    [discoveryChip, discoveryKind, onGetDynamicRecommendations, profile.id],
  );

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  useEffect(() => {
    if (activeTab === "recommended" && searchResults === null) {
      void fetchFeedPage(0, false, modrinthSort);
    }
  }, [activeTab, fetchFeedPage, modrinthSort, searchResults]);

  // Native Tauri v2 Drag & Drop listener (leak-free on fast unmount + respects Shaders tab)
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (!active) return;
          if (event.payload.type === "over") {
            setDragActive(true);
          } else if (event.payload.type === "leave") {
            setDragActive(false);
          } else if (event.payload.type === "drop") {
            setDragActive(false);
            const paths = event.payload.paths;
            if (!paths || paths.length === 0) return;

            const zipTargetKind: ContentKind =
              activeTabRef.current === "shaders" ? "shader" : "resource_pack";

            void (async () => {
              try {
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
                    await onImportContent(profile.id, zipTargetKind, fullPath);
                    imported += 1;
                  }
                }
                if (imported > 0 && active) {
                  setStatusMessage(
                    `Importados ${imported} archivo(s) en ${zipTargetKind === "shader" ? "shaderpacks/" : "la instancia"}.`,
                  );
                  await refreshLocal();
                }
              } catch (err) {
                if (active) {
                  setStatusMessage(
                    err instanceof Error ? err.message : JSON.stringify(err),
                  );
                }
              }
            })();
          }
        })
        .then((fn) => {
          if (active) {
            unlisten = fn;
          } else {
            fn();
          }
        })
        .catch(() => {
          // Browser preview fallback
        });
    } catch {
      // Browser preview fallback
    }
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [onImportContent, profile.id, refreshLocal]);

  const fpsPureInstalled = useMemo(
    () => FPS_PURE_SLUGS.every((slug) => hasInstalledSlug(installedMods, slug)),
    [installedMods],
  );

  const distantHorizonsInstalled = useMemo(
    () => hasInstalledSlug(installedMods, "distanthorizons"),
    [installedMods],
  );

  const c2meInstalled = useMemo(
    () => hasInstalledSlug(installedMods, "c2me-fabric"),
    [installedMods],
  );

  const bobbyInstalled = useMemo(
    () => hasInstalledSlug(installedMods, "bobby"),
    [installedMods],
  );

  const handleToggle = async (item: ContentItem, kind: ContentKind) => {
    try {
      const updated = await onToggleContent(
        profile.id,
        kind,
        item.file_name,
        !item.enabled,
      );
      const updater = (prev: ContentItem[]) =>
        prev.map((c) => (c.file_name === item.file_name ? updated : c));
      if (kind === "mod") {
        setInstalledMods(updater);
      } else if (kind === "resource_pack") {
        setResourcePacks(updater);
      } else {
        setShaderPacks(updater);
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    }
  };

  const handleDelete = async (item: ContentItem, kind: ContentKind) => {
    try {
      await onDeleteContent(profile.id, kind, item.file_name);
      const remover = (prev: ContentItem[]) =>
        prev.filter((c) => c.file_name !== item.file_name);
      if (kind === "mod") {
        setInstalledMods(remover);
      } else if (kind === "resource_pack") {
        setResourcePacks(remover);
      } else {
        setShaderPacks(remover);
      }
      setConfirmDeleteFile(null);
      setStatusMessage(`Eliminado ${item.display_name} (${item.file_name}).`);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    }
  };

  const handleManualImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const zipTargetKind: ContentKind =
      activeTab === "shaders" ? "shader" : "resource_pack";

    try {
      let count = 0;
      for (const file of files) {
        const lower = file.name.toLowerCase();
        const kind: ContentKind =
          lower.endsWith(".zip") || lower.endsWith(".zip.disabled")
            ? zipTargetKind
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
      if (count > 0) {
        setStatusMessage(`Importados ${count} archivo(s) en la instancia.`);
        await refreshLocal();
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const executeSearch = async (
    query: string,
    kind: ContentKind,
    offset: number,
    sort: ModrinthSort,
    append: boolean,
  ) => {
    const q = query.trim();
    if (!q) {
      searchReqRef.current += 1;
      setSearchResults(null);
      setSearchOffset(0);
      setSearchHasMore(false);
      return;
    }
    const reqId = ++searchReqRef.current;
    setSearching(true);
    setStatusMessage(null);
    try {
      const hits = await onSearchModrinth(
        profile.id,
        q,
        profile.mc_version,
        profile.loader,
        kind,
        offset,
        sort,
      );
      if (reqId !== searchReqRef.current) return;
      if (append) {
        setSearchResults((prev) => {
          const base = prev ?? [];
          const seen = new Set(base.map((r) => `${r.kind}:${r.slug}`));
          const merged = [...base];
          for (const h of hits) {
            if (!seen.has(`${h.kind}:${h.slug}`)) {
              merged.push(h);
            }
          }
          return merged;
        });
      } else {
        setSearchResults(hits);
      }
      setSearchOffset(offset);
      setSearchHasMore(hits.length >= 12);
    } catch (err) {
      if (reqId !== searchReqRef.current) return;
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      if (reqId === searchReqRef.current) {
        setSearching(false);
      }
    }
  };

  const handleSearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await executeSearch(searchQuery, searchKind, 0, modrinthSort, false);
  };

  const handleRefreshSuggestions = async () => {
    const nextOffset = feedHasMore ? feedOffset + 10 : 0;
    const items = await onGetDynamicRecommendations(
      profile.id,
      discoveryChip,
      discoveryKind,
      nextOffset,
      modrinthSort,
    );
    if (items.length === 0 && nextOffset > 0) {
      await fetchFeedPage(0, false, modrinthSort);
    } else {
      setDynamicFeed(items);
      setFeedOffset(nextOffset);
      setFeedHasMore(items.length >= 10);
    }
  };

  const handleLoadMore = async () => {
    if (searchResults !== null) {
      await executeSearch(
        searchQuery,
        searchKind,
        searchOffset + 12,
        modrinthSort,
        true,
      );
    } else {
      await fetchFeedPage(feedOffset + 10, true, modrinthSort);
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
      await fetchFeedPage(feedOffset, false, modrinthSort);
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
  const canLoadMore = searchResults !== null ? searchHasMore : feedHasMore;

  const currentLocalKind: ContentKind =
    activeTab === "resource_packs"
      ? "resource_pack"
      : activeTab === "shaders"
        ? "shader"
        : "mod";

  const filteredLocalItems = useMemo(() => {
    const raw =
      activeTab === "resource_packs"
        ? resourcePacks
        : activeTab === "shaders"
          ? shaderPacks
          : installedMods;
    const q = localQuery.trim().toLowerCase();
    const filtered = q
      ? raw.filter(
          (item) =>
            item.display_name.toLowerCase().includes(q) ||
            item.file_name.toLowerCase().includes(q) ||
            (item.mod_id?.toLowerCase().includes(q) ?? false),
        )
      : [...raw];

    filtered.sort((a, b) => {
      if (localSort === "size") return b.size_bytes - a.size_bytes;
      if (localSort === "enabled") {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      }
      return a.display_name.localeCompare(b.display_name);
    });
    return filtered;
  }, [activeTab, installedMods, resourcePacks, shaderPacks, localQuery, localSort]);

  return (
    <div className="h-full overflow-y-auto px-6 py-5 bg-[#07090D]">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jar,.zip"
        onChange={(e) => void handleManualImport(e)}
        className="hidden"
      />

      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header & Segmented Tabs */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight text-white">
              Mods, Resource Packs y Shaders
            </h1>
            <p className="text-[11px] font-mono text-slate-500">
              {profile.name} · MC {profile.mc_version} ({profile.loader})
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-[#0D1118] border border-white/[0.06] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("installed");
                  setConfirmDeleteFile(null);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "installed"
                    ? "bg-[#121722] text-[var(--accent-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Instalados ({installedMods.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("recommended")}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "recommended"
                    ? "bg-[#121722] text-[var(--accent-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Recomendados
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("resource_packs");
                  setConfirmDeleteFile(null);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "resource_packs"
                    ? "bg-[#121722] text-[var(--accent-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Packs ({resourcePacks.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("shaders");
                  setConfirmDeleteFile(null);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "shaders"
                    ? "bg-[#121722] text-[var(--accent-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Shaders ({shaderPacks.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-3 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] inline-flex items-center gap-1.5 text-xs font-medium text-slate-200 transition-colors"
            >
              <FolderPlus className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              Importar
            </button>

            <button
              type="button"
              onClick={() => {
                void refreshLocal();
                if (activeTab === "recommended" && searchResults === null) {
                  void fetchFeedPage(feedOffset, false, modrinthSort);
                }
              }}
              title="Recargar"
              className="h-8 w-8 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
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
            {activeTab === "shaders" ? "shaderpacks/" : profile.name}
          </div>
        )}

        {progress && busySlug && (
          <div className="rounded-xl forge-card px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--accent-primary)]">
                {progress.phase}
              </span>
              <span className="font-mono text-slate-300">
                {progress.completed}/{progress.total}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 truncate">
              {progress.detail}
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="rounded-xl forge-panel px-4 py-2.5 text-xs font-mono text-slate-300">
            {statusMessage}
          </div>
        )}

        {/* TAB: RECOMENDADOS & SMART SEARCH */}
        {activeTab === "recommended" && (
          <div className="space-y-5">
            {/* Performance & Chunk Presets (Fabric) */}
            {profile.loader === "fabric" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fpsPureInstalled ? (
                  <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Stack FPS Puros instalado (9 mods)
                    </span>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("fps_pure")}
                      className="rounded-md bg-[#07090D]/70 hover:bg-[#07090D] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors"
                    >
                      Actualizar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl forge-card p-4 flex flex-col justify-between gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
                          <Rocket className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          FPS Puros (Core Estable)
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          9 mods + deps
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
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
                  <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Acelerador C2ME instalado
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("installed")}
                      className="rounded-md bg-[#07090D]/70 hover:bg-[#07090D] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors"
                    >
                      Gestionar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl forge-card p-4 flex flex-col justify-between gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
                          <Cpu className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Acelerador de Chunks Singleplayer
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          C2ME · Multihilo
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Generación y carga paralela de chunks en local (ideal
                        para /tp y vuelos rápidos). Experimental en snapshots.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("c2me_chunk_accel")}
                      className="w-full rounded-lg bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-45 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-colors"
                    >
                      {busySlug === "c2me_chunk_accel"
                        ? "Instalando C2ME..."
                        : "Añadir C2ME (Singleplayer)"}
                    </button>
                  </div>
                )}

                {bobbyInstalled ? (
                  <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Bobby (Chunks Multijugador) instalado
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("installed")}
                      className="rounded-md bg-[#07090D]/70 hover:bg-[#07090D] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors"
                    >
                      Gestionar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl forge-card p-4 flex flex-col justify-between gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
                          <Globe2 className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Horizonte Multijugador (Bobby)
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          Caché MP
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Guarda chunks en caché local para ver más allá del
                        límite de view-distance de servidores multijugador.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("bobby_multiplayer")}
                      className="w-full rounded-lg bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-45 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-colors"
                    >
                      {busySlug === "bobby_multiplayer"
                        ? "Instalando Bobby..."
                        : "Añadir Bobby (Multijugador)"}
                    </button>
                  </div>
                )}

                {distantHorizonsInstalled ? (
                  <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] px-4 py-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--accent-primary)]">
                      <Check className="h-4 w-4" />
                      Distant Horizons instalado
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("installed")}
                      className="rounded-md bg-[#07090D]/70 hover:bg-[#07090D] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors"
                    >
                      Gestionar
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl forge-card p-4 flex flex-col justify-between gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
                          <Compass className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          Horizonte Opcional (LODs)
                        </span>
                        <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-mono text-[var(--accent-primary)]">
                          64+ chunks
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Distant Horizons independiente del pack base para
                        horizontes masivos bajo demanda.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busySlug !== null}
                      onClick={() => void handlePreset("distant_horizons")}
                      className="w-full rounded-lg bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-45 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-colors"
                    >
                      {busySlug === "distant_horizons"
                        ? "Instalando Distant Horizons..."
                        : "Añadir Distant Horizons"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Smart Modrinth Search Bar + Sort */}
            <form
              onSubmit={(e) => void handleSearchSubmit(e)}
              className="flex flex-wrap items-center gap-2"
            >
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value.trim()) {
                      setSearchResults(null);
                      setSearchOffset(0);
                      setSearchHasMore(false);
                    }
                  }}
                  placeholder={`Buscar en Modrinth para ${profile.loader} ${profile.mc_version}...`}
                  className="w-full rounded-lg bg-[#0D1118] border border-white/[0.08] pl-9 pr-3 py-2 text-[13px] text-white placeholder:text-slate-500 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <select
                value={searchKind}
                onChange={(e) => setSearchKind(e.target.value as ContentKind)}
                className="rounded-lg bg-[#0D1118] border border-white/[0.08] px-3 py-2 text-xs text-slate-200 focus:border-[var(--accent-primary)] focus:outline-none"
              >
                <option value="mod">Mods</option>
                <option value="resource_pack">Resource Packs</option>
                <option value="shader">Shaders</option>
              </select>

              <select
                value={modrinthSort}
                onChange={(e) => {
                  const nextSort = e.target.value as ModrinthSort;
                  setModrinthSort(nextSort);
                  if (searchResults !== null && searchQuery.trim()) {
                    void executeSearch(
                      searchQuery,
                      searchKind,
                      0,
                      nextSort,
                      false,
                    );
                  }
                }}
                title="Ordenar resultados"
                className="rounded-lg bg-[#0D1118] border border-white/[0.08] px-3 py-2 text-xs text-slate-200 focus:border-[var(--accent-primary)] focus:outline-none"
              >
                <option value="downloads">Descargas</option>
                <option value="relevance">Relevancia</option>
                <option value="newest">Nuevos</option>
                <option value="updated">Actualizados</option>
              </select>

              <button
                type="submit"
                disabled={searching}
                className="rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.08] px-4 py-2 text-xs font-medium text-white disabled:opacity-50 transition-colors"
              >
                {searching ? "Buscando..." : "Buscar"}
              </button>
            </form>

            {/* Dynamic Discovery Filter Chips */}
            {!searchResults && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: "performance", label: "Rendimiento" },
                      { id: "visual", label: "Visual y Ambiente" },
                      { id: "qol", label: "Calidad de Vida" },
                      { id: "world", label: "Mundo y Aventura" },
                      { id: "resource_pack", label: "Resource Packs" },
                      { id: "shader", label: "Shaders" },
                    ] as { id: DiscoveryChip; label: string }[]
                  ).map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setDiscoveryChip(chip.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        discoveryChip === chip.id
                          ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]"
                          : "bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={loadingFeed}
                  onClick={() => void handleRefreshSuggestions()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-45 transition-colors"
                >
                  <Shuffle className="h-3 w-3 text-[var(--accent-primary)]" />
                  Renovar sugerencias
                </button>
              </div>
            )}

            {/* Dynamic "Te podría gustar" / Search Results Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
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
                      setSearchOffset(0);
                      setSearchHasMore(false);
                    }}
                    className="text-xs text-[var(--accent-primary)] hover:underline"
                  >
                    Volver a descubrimiento
                  </button>
                )}
              </div>

              {loadingFeed && displayList.length === 0 && !searchResults ? (
                <div className="rounded-xl forge-panel p-6 text-center text-xs font-mono text-slate-500">
                  Consultando Modrinth API v2...
                </div>
              ) : displayList.length === 0 ? (
                <div className="rounded-xl forge-panel p-6 text-center text-xs font-mono text-slate-500">
                  No se encontraron resultados nuevos para esta categoría.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {displayList.map((item) => {
                      const isInstalling = busySlug === item.slug;
                      const disabledByLoader =
                        item.kind === "mod" && profile.loader === "vanilla";

                      return (
                        <div
                          key={`${item.kind}-${item.slug}`}
                          className="rounded-xl forge-card-interactive p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            {item.icon_url ? (
                              <img
                                src={item.icon_url}
                                alt={item.title}
                                className="h-10 w-10 rounded-lg object-cover shrink-0 bg-[#07090D] border border-white/[0.06]"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-lg bg-[#07090D] border border-white/[0.06] flex items-center justify-center text-[var(--accent-primary)] shrink-0">
                                {item.kind === "mod" ? (
                                  <Package className="h-4 w-4" />
                                ) : item.kind === "shader" ? (
                                  <Sun className="h-4 w-4" />
                                ) : (
                                  <FileArchive className="h-4 w-4" />
                                )}
                              </div>
                            )}

                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-semibold text-white truncate">
                                  {item.title}
                                </span>
                                <span className="shrink-0 text-[10px] font-mono text-slate-500">
                                  {formatDownloads(item.downloads)} DL
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 line-clamp-1">
                                {item.description}
                              </p>
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                {!item.compatible && item.compatibility_note && (
                                  <span className="inline-flex items-center gap-1 rounded bg-[#F59E0B]/12 px-1.5 py-0.5 text-[10px] font-mono text-[#F59E0B]">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    {item.compatibility_note}
                                  </span>
                                )}
                                {item.performance_warning && (
                                  <span className="inline-flex items-center gap-1 rounded bg-[#F59E0B]/10 px-1.5 py-0.5 text-[10px] font-mono text-[#F59E0B]">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    {item.performance_warning}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {item.installed ? (
                            <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--accent-primary)]">
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
                              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white transition-colors"
                            >
                              <Download className="h-3 w-3 text-[var(--accent-primary)]" />
                              {isInstalling ? "..." : "Instalar"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {canLoadMore && (
                    <div className="pt-1 flex justify-center">
                      <button
                        type="button"
                        disabled={loadingFeed || searching}
                        onClick={() => void handleLoadMore()}
                        className="rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.07] px-5 py-2 text-xs font-medium text-slate-200 disabled:opacity-45 transition-colors"
                      >
                        {loadingFeed || searching
                          ? "Cargando..."
                          : "Cargar más resultados"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB: INSTALADOS / RESOURCE PACKS / SHADERS */}
        {(activeTab === "installed" ||
          activeTab === "resource_packs" ||
          activeTab === "shaders") && (
          <div className="space-y-3.5">
            {/* Local Search & Sort Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={localQuery}
                  onChange={(e) => setLocalQuery(e.target.value)}
                  placeholder="Filtrar elementos instalados por nombre o archivo..."
                  className="w-full rounded-lg bg-[#0D1118] border border-white/[0.08] pl-9 pr-3 py-2 text-[13px] text-white placeholder:text-slate-500 focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <select
                value={localSort}
                onChange={(e) => setLocalSort(e.target.value as LocalSort)}
                className="rounded-lg bg-[#0D1118] border border-white/[0.08] px-3 py-2 text-xs text-slate-200 focus:border-[var(--accent-primary)] focus:outline-none"
              >
                <option value="name">Nombre (A-Z)</option>
                <option value="size">Tamaño (mayor)</option>
                <option value="enabled">Activos primero</option>
              </select>
            </div>

            <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#0D1118]/70 px-4 py-3 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Upload className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                Arrastra archivos{" "}
                <code className="text-[var(--accent-primary)]">
                  {activeTab === "installed" ? ".jar" : ".zip"}
                </code>{" "}
                a esta ventana para importarlos en{" "}
                <code className="text-slate-300">
                  {activeTab === "shaders"
                    ? "shaderpacks/"
                    : activeTab === "resource_packs"
                      ? "resourcepacks/"
                      : "mods/"}
                </code>
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[var(--accent-primary)] hover:underline font-medium"
              >
                Seleccionar archivo
              </button>
            </div>

            <div className="divide-y divide-white/[0.05] rounded-xl forge-panel overflow-hidden">
              {filteredLocalItems.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-slate-500">
                  {localQuery.trim()
                    ? "Sin coincidencias para el filtro actual."
                    : "No hay elementos instalados todavía."}
                </div>
              ) : (
                filteredLocalItems.map((item) => {
                  const isConfirming = confirmDeleteFile === item.file_name;
                  return (
                    <div
                      key={item.file_name}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.025] transition-colors"
                    >
                      <div className="min-w-0 pr-2 flex items-center gap-3">
                        {currentLocalKind === "mod" ? (
                          <Package className="h-4 w-4 text-slate-500 shrink-0" />
                        ) : currentLocalKind === "shader" ? (
                          <Sun className="h-4 w-4 text-slate-500 shrink-0" />
                        ) : (
                          <FileArchive className="h-4 w-4 text-slate-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[13px] font-medium truncate ${
                                item.enabled
                                  ? "text-slate-100"
                                  : "text-slate-500 line-through"
                              }`}
                            >
                              {item.display_name}
                            </span>
                            {item.version && (
                              <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                                v{item.version}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] font-mono text-slate-500 truncate">
                            {item.file_name} · {formatSize(item.size_bytes)}
                            {item.mod_id ? ` · ${item.mod_id}` : ""}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isConfirming ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                void handleDelete(item, currentLocalKind)
                              }
                              className="rounded-md bg-rose-600 hover:bg-rose-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                            >
                              Eliminar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFile(null)}
                              className="rounded-md bg-white/[0.06] hover:bg-white/[0.1] px-2.5 py-1 text-[11px] text-slate-300 transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFile(item.file_name)}
                            title="Eliminar archivo"
                            className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.enabled}
                          onClick={() =>
                            void handleToggle(item, currentLocalKind)
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                            item.enabled
                              ? "bg-[var(--accent-soft)] border-[var(--accent-border)]"
                              : "bg-[#07090D] border-white/[0.12]"
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
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
