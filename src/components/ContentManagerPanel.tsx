import { useCallback, useEffect, useState } from "react";
import {
  FileArchive,
  Package,
  RefreshCw,
  Rocket,
  Upload,
} from "lucide-react";
import type {
  ContentItem,
  ContentKind,
  LaunchProgressEvent,
  Profile,
} from "../types/launcher";

interface ContentManagerPanelProps {
  profile: Profile;
  onListContent: (
    profileId: string,
    kind: ContentKind,
  ) => Promise<ContentItem[]>;
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
  onInjectPerformanceStack: (
    profileId: string,
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
  onToggleContent,
  onImportContent,
  onInjectPerformanceStack,
}: ContentManagerPanelProps) {
  const [activeTab, setActiveTab] = useState<ContentKind>("mod");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [injectProgress, setInjectProgress] =
    useState<LaunchProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const refreshItems = useCallback(async () => {
    setLoading(true);
    try {
      const list = await onListContent(profile.id, activeTab);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [activeTab, onListContent, profile.id]);

  useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  const handleToggle = async (item: ContentItem) => {
    const updated = await onToggleContent(
      profile.id,
      activeTab,
      item.file_name,
      !item.enabled,
    );
    setItems((prev) =>
      prev.map((curr) =>
        curr.file_name === item.file_name ? updated : curr,
      ),
    );
  };

  const handleInjectStack = async () => {
    setInjecting(true);
    setStatusMessage(null);
    try {
      const installed = await onInjectPerformanceStack(profile.id, (ev) => {
        setInjectProgress(ev);
      });
      setStatusMessage(
        `Stack de rendimiento instalado (${installed.length} mods): ${installed.join(", ")}`,
      );
      if (activeTab === "mod") {
        await refreshItems();
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    } finally {
      setInjecting(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      const fileWithPath = file as File & { path?: string };
      if (fileWithPath.path) {
        await onImportContent(profile.id, activeTab, fileWithPath.path);
      }
    }
    await refreshItems();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#334155] bg-[#0f172a] p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("mod")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold border transition-colors ${
                activeTab === "mod"
                  ? "bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/40"
                  : "bg-[#1e293b]/50 text-slate-400 border-[#334155] hover:text-slate-200"
              }`}
            >
              <Package className="h-4 w-4" />
              Mods (.jar)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("resource_pack")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold border transition-colors ${
                activeTab === "resource_pack"
                  ? "bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/40"
                  : "bg-[#1e293b]/50 text-slate-400 border-[#334155] hover:text-slate-200"
              }`}
            >
              <FileArchive className="h-4 w-4" />
              Paquetes de Recursos (.zip)
            </button>
            <button
              type="button"
              onClick={() => void refreshItems()}
              className="p-2 rounded-xl border border-[#334155] text-slate-400 hover:text-white hover:bg-[#1e293b]"
              title="Recargar carpeta del perfil"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {profile.loader === "fabric" && (
            <button
              type="button"
              disabled={injecting}
              onClick={() => void handleInjectStack()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#10b981] hover:bg-emerald-400 disabled:opacity-50 px-4 py-2.5 text-xs font-bold text-slate-950 transition-colors"
            >
              <Rocket className="h-4 w-4" />
              {injecting
                ? "Descargando Stack Modrinth..."
                : "Inyectar Pack de Rendimiento"}
            </button>
          )}
        </div>

        <p className="text-xs text-slate-400">
          El Pack de Rendimiento para Fabric instala automáticamente desde
          Modrinth: <strong className="text-slate-200">Sodium</strong>,{" "}
          <strong className="text-slate-200">Lithium</strong>,{" "}
          <strong className="text-slate-200">FerriteCore</strong>,{" "}
          <strong className="text-slate-200">ImmediatelyFast</strong>,{" "}
          <strong className="text-slate-200">C2ME</strong> y{" "}
          <strong className="text-slate-200">Distant Horizons</strong>.
        </p>

        {injectProgress && injecting && (
          <div className="rounded-xl border border-[#334155] bg-[#0b1120] p-3 text-xs space-y-1.5">
            <div className="flex justify-between text-[#38bdf8] font-medium">
              <span>{injectProgress.phase}</span>
              <span className="font-mono">
                {injectProgress.completed}/{injectProgress.total}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate">
              {injectProgress.detail}
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="rounded-xl border border-[#334155] bg-[#1e293b]/70 px-4 py-2.5 text-xs text-slate-200">
            {statusMessage}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => void handleDrop(e)}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            dragActive
              ? "border-[#38bdf8] bg-[#38bdf8]/10"
              : "border-[#334155] bg-[#0b1120]/60"
          }`}
        >
          <Upload className="h-5 w-5 mx-auto text-[#38bdf8] mb-1.5" />
          <p className="text-xs text-slate-300">
            Arrastra archivos{" "}
            <code className="text-[#38bdf8]">
              {activeTab === "mod" ? ".jar" : ".zip"}
            </code>{" "}
            aquí para copiarlos a{" "}
            <code className="text-slate-400">instances/{profile.id}/</code>
          </p>
        </div>

        <div className="divide-y divide-[#334155]/70 rounded-xl border border-[#334155] bg-[#0b1120] overflow-hidden">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No hay elementos en esta carpeta todavía.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.file_name}
                className="flex items-center justify-between px-4 py-3 hover:bg-[#1e293b]/40"
              >
                <div className="min-w-0 pr-4">
                  <div
                    className={`text-sm font-medium truncate ${
                      item.enabled
                        ? "text-slate-100"
                        : "text-slate-500 line-through"
                    }`}
                  >
                    {item.display_name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {item.file_name} · {formatSize(item.size_bytes)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleToggle(item)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                    item.enabled
                      ? "bg-[#10b981]/15 text-[#10b981] border-[#10b981]/40 hover:bg-[#10b981]/25"
                      : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {item.enabled ? "Activo" : "Desactivado"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
