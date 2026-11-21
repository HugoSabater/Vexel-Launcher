import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  FolderOpen,
  Gauge,
  Globe,
  Home,
  Layers,
  Pencil,
  Play,
  Plus,
  Square,
  Star,
  Terminal,
  Trash2,
  User,
  X,
} from "lucide-react";
import { USERNAME_REGEX } from "../theme/accents";
import type {
  GcPreset,
  HardwareInfo,
  ModLoaderKind,
  Profile,
} from "../types/launcher";

export type MainView = "home" | "content" | "performance";

interface SidebarProfilesProps {
  profiles: Profile[];
  selectedProfileId: string;
  runningProfileIds: Record<string, boolean>;
  activeView: MainView;
  consoleOpen: boolean;
  offlineUsername: string;
  hardware: HardwareInfo;
  onSelectProfile: (profileId: string) => void;
  onSelectView: (view: MainView) => void;
  onToggleConsole: () => void;
  onUpdateUsername: (username: string) => Promise<void>;
  onPlayProfile: (profileId: string) => Promise<void>;
  onStopProfile: (profileId: string) => Promise<void>;
  onOpenFolder: (profileId: string) => Promise<void>;
  onDuplicateProfile: (profile: Profile) => Promise<void>;
  onSetDefault: (profileId: string) => Promise<void>;
  onSaveProfile: (profile: Profile) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
}

const LOADER_DOT: Record<ModLoaderKind, string> = {
  vanilla: "bg-[#10B981]",
  fabric: "bg-[#38BDF8]",
  forge: "bg-amber-400",
  neo_forge: "bg-orange-400",
};

interface ContextMenuState {
  x: number;
  y: number;
  profile: Profile;
}

function slugifyProfileId(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${clean || "profile"}-${Date.now().toString(36).slice(-4)}`;
}

export function SidebarProfiles({
  profiles,
  selectedProfileId,
  runningProfileIds,
  activeView,
  consoleOpen,
  offlineUsername,
  hardware,
  onSelectProfile,
  onSelectView,
  onToggleConsole,
  onUpdateUsername,
  onPlayProfile,
  onStopProfile,
  onOpenFolder,
  onDuplicateProfile,
  onSetDefault,
  onSaveProfile,
  onDeleteProfile,
}: SidebarProfilesProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(offlineUsername);

  const [name, setName] = useState("");
  const [mcVersion, setMcVersion] = useState("1.21.4");
  const [loader, setLoader] = useState<ModLoaderKind>("fabric");
  const [ramMb, setRamMb] = useState<number>(hardware.recommended_modded_mb);
  const [gcPreset, setGcPreset] = useState<GcPreset>("generational_zgc");
  const [serverAddress, setServerAddress] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNickDraft(offlineUsername);
  }, [offlineUsername]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [contextMenu]);

  const openModal = () => {
    setName("");
    setMcVersion("1.21.4");
    setLoader("fabric");
    setRamMb(hardware.recommended_modded_mb);
    setGcPreset("generational_zgc");
    setServerAddress("");
    setModalOpen(true);
  };

  const handleLoaderChange = (nextLoader: ModLoaderKind) => {
    setLoader(nextLoader);
    setRamMb(
      nextLoader === "vanilla"
        ? hardware.recommended_vanilla_mb
        : hardware.recommended_modded_mb,
    );
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !mcVersion.trim()) return;
    setSaving(true);
    try {
      const profile: Profile = {
        id: slugifyProfileId(name),
        name: name.trim(),
        mc_version: mcVersion.trim(),
        loader,
        loader_version: null,
        ram_mb: ramMb,
        gc_preset: gcPreset,
        server_address: serverAddress.trim() ? serverAddress.trim() : null,
        is_default: false,
        window_width: null,
        window_height: null,
        fullscreen: false,
        custom_jvm_args: null,
        custom_java_path: null,
      };
      await onSaveProfile(profile);
      onSelectProfile(profile.id);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCommitNick = async () => {
    setEditingNick(false);
    const trimmed = nickDraft.trim();
    if (trimmed && trimmed !== offlineUsername) {
      if (!USERNAME_REGEX.test(trimmed)) {
        setNickDraft(offlineUsername);
        await onUpdateUsername(trimmed);
        return;
      }
      try {
        await onUpdateUsername(trimmed);
      } catch {
        setNickDraft(offlineUsername);
      }
    } else {
      setNickDraft(offlineUsername);
    }
  };

  return (
    <aside className="w-[240px] shrink-0 bg-[#11151E] border-r border-[#1E2534] flex flex-col">
      {/* Compact Player Identity Strip (3D Avatar lives in Home & Skin tab) */}
      <div className="p-3 border-b border-[#1E2534]">
        <div className="rounded-lg bg-[#080A0F] border border-[#1E2534] px-2.5 py-2 flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent-primary)] shrink-0">
            <User className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            {editingNick ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCommitNick();
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="text"
                  autoFocus
                  maxLength={16}
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  onBlur={() => void handleCommitNick()}
                  className="w-full rounded bg-[#11151E] border border-[var(--accent-primary)] px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="p-0.5 text-[var(--accent-primary)]"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingNick(true)}
                title="Clic para editar nombre offline"
                className="group w-full flex items-center justify-between gap-1 text-left"
              >
                <span className="truncate text-xs font-semibold text-white">
                  {offlineUsername}
                </span>
                <Pencil className="h-3 w-3 text-slate-600 group-hover:text-[var(--accent-primary)] shrink-0 transition-colors" />
              </button>
            )}
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
              <span>Offline</span>
            </div>
          </div>
        </div>
      </div>

      {/* Center: Compact Instance List */}
      <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          Instancias ({profiles.length})
        </span>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-soft)] transition-colors"
        >
          <Plus className="h-3 w-3" />
          Nueva
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {profiles.map((profile) => {
          const isSelected = profile.id === selectedProfileId;
          const isRunning = Boolean(runningProfileIds[profile.id]);

          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onSelectProfile(profile.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelectProfile(profile.id);
                setContextMenu({
                  x: Math.min(e.clientX, window.innerWidth - 210),
                  y: Math.min(e.clientY, window.innerHeight - 210),
                  profile,
                });
              }}
              className={`relative w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2.5 transition-colors ${
                isSelected
                  ? "bg-[#171D2A] border border-[var(--accent-border)] text-white"
                  : "border border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#171D2A]/50"
              }`}
            >
              {isSelected && (
                <span className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full bg-[var(--accent-primary)]" />
              )}

              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  isRunning
                    ? "bg-[var(--accent-primary)] animate-pulse"
                    : LOADER_DOT[profile.loader]
                }`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-xs font-medium">
                    {profile.name}
                  </span>
                  {profile.is_default && (
                    <Star
                      className="h-2.5 w-2.5 shrink-0 text-slate-500"
                      fill="currentColor"
                    />
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <span>{profile.mc_version}</span>
                  <span>·</span>
                  <span className="capitalize">{profile.loader}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom Pinned: Navigation + Console Trigger */}
      <div className="p-2 border-t border-[#1E2534] space-y-0.5">
        <button
          type="button"
          onClick={() => onSelectView("home")}
          className={`w-full rounded-lg px-2.5 py-2 flex items-center gap-2.5 text-xs font-medium transition-colors ${
            activeView === "home"
              ? "bg-[var(--accent-soft)] text-white border border-[var(--accent-border)]"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#171D2A]/50 border border-transparent"
          }`}
        >
          <Home
            className={`h-3.5 w-3.5 ${activeView === "home" ? "text-[var(--accent-primary)]" : ""}`}
          />
          Inicio
        </button>

        <button
          type="button"
          onClick={() => onSelectView("content")}
          className={`w-full rounded-lg px-2.5 py-2 flex items-center gap-2.5 text-xs font-medium transition-colors ${
            activeView === "content"
              ? "bg-[var(--accent-soft)] text-white border border-[var(--accent-border)]"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#171D2A]/50 border border-transparent"
          }`}
        >
          <Layers
            className={`h-3.5 w-3.5 ${activeView === "content" ? "text-[var(--accent-primary)]" : ""}`}
          />
          Mods y Packs
        </button>

        <button
          type="button"
          onClick={() => onSelectView("performance")}
          className={`w-full rounded-lg px-2.5 py-2 flex items-center gap-2.5 text-xs font-medium transition-colors ${
            activeView === "performance"
              ? "bg-[var(--accent-soft)] text-white border border-[var(--accent-border)]"
              : "text-slate-400 hover:text-slate-200 hover:bg-[#171D2A]/50 border border-transparent"
          }`}
        >
          <Gauge
            className={`h-3.5 w-3.5 ${activeView === "performance" ? "text-[var(--accent-primary)]" : ""}`}
          />
          Ajustes
        </button>

        <div className="pt-1 mt-1 border-t border-[#1E2534]">
          <button
            type="button"
            onClick={onToggleConsole}
            className={`w-full rounded-lg px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono transition-colors ${
              consoleOpen
                ? "bg-[var(--accent-soft)] text-[var(--accent-primary)] border border-[var(--accent-border)]"
                : "text-slate-500 hover:text-slate-200 hover:bg-[#171D2A]/50 border border-transparent"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5" />
              Consola
            </span>
            <span className="text-[10px] text-slate-600">Ctrl+L</span>
          </button>
        </div>
      </div>

      {/* Native Right-Click Context Menu */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-xl bg-[#11151E] border border-[#1E2534] py-1.5 shadow-2xl"
        >
          {runningProfileIds[contextMenu.profile.id] ? (
            <button
              type="button"
              onClick={() => {
                const id = contextMenu.profile.id;
                setContextMenu(null);
                void onStopProfile(id);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-rose-300 hover:bg-[#171D2A] flex items-center gap-2.5"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Detener instancia
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const id = contextMenu.profile.id;
                setContextMenu(null);
                void onPlayProfile(id);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--accent-primary)] hover:bg-[#171D2A] flex items-center gap-2.5"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Jugar
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const id = contextMenu.profile.id;
              setContextMenu(null);
              void onOpenFolder(id);
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-[#171D2A] flex items-center gap-2.5"
          >
            <FolderOpen className="h-3.5 w-3.5 text-slate-400" />
            Abrir carpeta de la instancia
          </button>

          <button
            type="button"
            onClick={() => {
              const target = contextMenu.profile;
              setContextMenu(null);
              void onDuplicateProfile(target);
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-[#171D2A] flex items-center gap-2.5"
          >
            <Copy className="h-3.5 w-3.5 text-slate-400" />
            Duplicar perfil
          </button>

          <button
            type="button"
            onClick={() => {
              const id = contextMenu.profile.id;
              setContextMenu(null);
              void onSetDefault(id);
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-[#171D2A] flex items-center gap-2.5"
          >
            <Star className="h-3.5 w-3.5 text-slate-400" />
            Fijar como predeterminado
          </button>

          {profiles.length > 1 && (
            <>
              <div className="my-1 border-t border-[#1E2534]" />
              <button
                type="button"
                onClick={() => {
                  const id = contextMenu.profile.id;
                  setContextMenu(null);
                  void onDeleteProfile(id);
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar
              </button>
            </>
          )}
        </div>
      )}

      {/* New Profile Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-xl bg-[#11151E] border border-[#1E2534] p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#1E2534] pb-3">
              <h2 className="text-sm font-semibold text-white">
                Nueva Instancia
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#171D2A]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Nombre
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Survival 1.21.4 Fabric"
                  className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs text-white focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Versión MC
                  </label>
                  <input
                    type="text"
                    required
                    value={mcVersion}
                    onChange={(e) => setMcVersion(e.target.value)}
                    className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs font-mono text-white focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Loader
                  </label>
                  <select
                    value={loader}
                    onChange={(e) =>
                      handleLoaderChange(e.target.value as ModLoaderKind)
                    }
                    className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs text-white focus:border-[var(--accent-primary)] focus:outline-none"
                  >
                    <option value="vanilla">Vanilla</option>
                    <option value="fabric">Fabric</option>
                    <option value="forge" disabled>
                      Forge (Próximamente)
                    </option>
                    <option value="neo_forge" disabled>
                      NeoForge (Próximamente)
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1.5">
                    RAM{" "}
                    <span className="font-mono text-[var(--accent-primary)]">
                      {(ramMb / 1024).toFixed(1)} GB
                    </span>
                  </label>
                  <input
                    type="range"
                    min={1024}
                    max={hardware.max_safe_ram_mb}
                    step={512}
                    value={ramMb}
                    onChange={(e) => setRamMb(Number(e.target.value))}
                    className="w-full forge-slider"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Garbage Collector
                  </label>
                  <select
                    value={gcPreset}
                    onChange={(e) => setGcPreset(e.target.value as GcPreset)}
                    className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs text-white focus:border-[var(--accent-primary)] focus:outline-none"
                  >
                    <option value="generational_zgc">Generational ZGC</option>
                    <option value="aikar_g1_gc">Aikar&apos;s G1GC</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
                  <Globe className="h-3 w-3 text-[var(--accent-primary)]" />
                  Servidor QuickPlay (Opcional)
                </label>
                <input
                  type="text"
                  value={serverAddress}
                  onChange={(e) => setServerAddress(e.target.value)}
                  placeholder="play.servidor.net:25565"
                  className="w-full rounded-lg border border-[#1E2534] bg-[#080A0F] px-3 py-2 text-xs font-mono text-white focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#1E2534]">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-[#1E2534] px-3.5 py-1.5 text-xs text-slate-300 hover:bg-[#171D2A]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-accent rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {saving ? "Creando..." : "Crear"}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
