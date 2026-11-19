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
        `Instalados (${installed.length} con dependencias requeridas): ${installed.join(", ")}`,
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
    <div className="h-full overflow-y-auto p-6 bg-[#0A0C10]">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Mods y Paquetes · {profile.name}
            </h2>
            <p className="text-xs font-mono text-slate-500">
              instances/{profile.id}/ · {profile.mc_version} ({profile.loader})
            </p>
          </div>

          {profile.loader === "fabric" && (
            <button
              type="button"
              disabled={injecting}
              onClick={() => void handleInjectStack()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors"
            >
              <Rocket className="h-3.5 w-3.5" />
              {injecting
                ? "Resolviendo Modrinth + Deps..."
                : "Inyectar Pack de Rendimiento"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("mod")}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
              activeTab === "mod"
                ? "bg-[#181D28] text-white border-white/[0.08]"
                : "bg-transparent text-slate-400 border-transparent hover:bg-[#181D28]/50"
            }`}
          >
            <Package className="h-3.5 w-3.5 text-[#38BDF8]" />
            Mods
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("resource_pack")}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
              activeTab === "resource_pack"
                ? "bg-[#181D28] text-white border-white/[0.08]"
                : "bg-transparent text-slate-400 border-transparent hover:bg-[#181D28]/50"
            }`}
          >
            <FileArchive className="h-3.5 w-3.5 text-[#38BDF8]" />
            Resource Packs
          </button>
          <button
            type="button"
            onClick={() => void refreshItems()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#181D28]"
            title="Recargar"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {injectProgress && injecting && (
          <div className="rounded-lg bg-[#10131A] border border-white/[0.06] px-4 py-2.5 text-xs space-y-1">
            <div className="flex justify-between text-[#38BDF8] font-medium text-[11px]">
              <span>{injectProgress.phase}</span>
              <span className="font-mono">
                {injectProgress.completed}/{injectProgress.total}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {injectProgress.detail}
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="rounded-lg bg-[#10131A] border border-white/[0.06] px-4 py-2.5 text-xs font-mono text-slate-300">
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
          className={`rounded-xl border border-dashed p-5 text-center transition-colors ${
            dragActive
              ? "border-[#38BDF8] bg-[#38BDF8]/10"
              : "border-white/[0.1] bg-[#10131A]/60"
          }`}
        >
          <Upload className="h-4 w-4 mx-auto text-[#38BDF8] mb-1.5" />
          <p className="text-xs text-slate-400">
            Arrastra archivos{" "}
            <code className="text-[#38BDF8]">
              {activeTab === "mod" ? ".jar" : ".zip"}
            </code>{" "}
            aquí para instalarlos en el perfil
          </p>
        </div>

        <div className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-[#10131A] overflow-hidden">
          {items.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-slate-500">
              Carpeta vacía
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.file_name}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-[#181D28]/60 transition-colors"
              >
                <div className="min-w-0 pr-4">
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

                <button
                  type="button"
                  onClick={() => void handleToggle(item)}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold border transition-colors ${
                    item.enabled
                      ? "bg-[#10B981]/12 text-[#10B981] border-[#10B981]/30"
                      : "bg-[#181D28] text-slate-500 border-white/[0.06] hover:text-slate-300"
                  }`}
                >
                  {item.enabled ? "ACTIVO" : "INACTIVO"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
