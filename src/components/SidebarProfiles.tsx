import { useState } from "react";
import {
  Cpu,
  Globe,
  Plus,
  Server,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type {
  GcPreset,
  HardwareInfo,
  ModLoaderKind,
  Profile,
} from "../types/launcher";

interface SidebarProfilesProps {
  profiles: Profile[];
  selectedProfileId: string;
  hardware: HardwareInfo;
  onSelectProfile: (profileId: string) => void;
  onSetDefault: (profileId: string) => Promise<void>;
  onSaveProfile: (profile: Profile) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
}

const LOADER_BADGE_STYLES: Record<ModLoaderKind, string> = {
  vanilla: "bg-slate-800 text-slate-300 border-slate-700",
  fabric: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  forge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  neo_forge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

const LOADER_LABELS: Record<ModLoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neo_forge: "NeoForge",
};

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
  hardware,
  onSelectProfile,
  onSetDefault,
  onSaveProfile,
  onDeleteProfile,
}: SidebarProfilesProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [mcVersion, setMcVersion] = useState("1.21.4");
  const [loader, setLoader] = useState<ModLoaderKind>("fabric");
  const [ramMb, setRamMb] = useState<number>(hardware.recommended_modded_mb);
  const [gcPreset, setGcPreset] = useState<GcPreset>("generational_zgc");
  const [serverAddress, setServerAddress] = useState("");
  const [saving, setSaving] = useState(false);

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
      };
      await onSaveProfile(profile);
      onSelectProfile(profile.id);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="w-72 shrink-0 border-r border-[#334155] bg-[#0f172a] flex flex-col">
      <div className="p-4 border-b border-[#334155]">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 flex items-center justify-center text-[#10b981]">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              MC Launcher Rust
            </h1>
            <p className="text-[11px] text-slate-400">
              {Math.round(hardware.total_ram_mb / 1024)} GB RAM ·{" "}
              {hardware.logical_cores} hilos
            </p>
          </div>
        </div>
      </div>

      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Perfiles ({profiles.length})
        </span>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1 rounded-lg bg-[#38bdf8]/15 border border-[#38bdf8]/30 px-2.5 py-1 text-xs font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo Perfil
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
        {profiles.map((profile) => {
          const isSelected = profile.id === selectedProfileId;
          return (
            <div
              key={profile.id}
              onClick={() => onSelectProfile(profile.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  onSelectProfile(profile.id);
                }
              }}
              className={`group rounded-xl border p-3 cursor-pointer transition-all ${
                isSelected
                  ? "bg-[#1e293b] border-[#38bdf8]/70 shadow-lg shadow-sky-950/30"
                  : "bg-[#0b1120]/60 border-[#334155]/70 hover:border-[#334155] hover:bg-[#1e293b]/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-slate-100">
                      {profile.name}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[#0b1120] px-1.5 py-0.5 text-[11px] font-mono text-slate-300 border border-[#334155]">
                      {profile.mc_version}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${LOADER_BADGE_STYLES[profile.loader]}`}
                    >
                      {LOADER_LABELS[profile.loader]}
                    </span>
                    {profile.is_default && (
                      <span className="rounded bg-[#10b981]/15 border border-[#10b981]/30 px-1.5 py-0.5 text-[10px] font-semibold text-[#10b981]">
                        Por defecto
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Marcar como perfil por defecto"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onSetDefault(profile.id);
                    }}
                    className={`p-1 rounded hover:bg-[#0b1120] transition-colors ${
                      profile.is_default
                        ? "text-[#10b981]"
                        : "text-slate-500 hover:text-slate-200"
                    }`}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      fill={profile.is_default ? "currentColor" : "none"}
                    />
                  </button>
                  {profiles.length > 1 && (
                    <button
                      type="button"
                      title="Quitar perfil de la lista"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteProfile(profile.id);
                      }}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-[#0b1120] opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {profile.server_address && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#38bdf8]">
                  <Server className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">
                    {profile.server_address}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-2xl border border-[#334155] bg-[#0f172a] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                Crear Nuevo Perfil Aislado
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nombre del Perfil
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Survival Optimizado 1.21.4"
                  className="w-full rounded-lg border border-[#334155] bg-[#0b1120] px-3 py-2 text-sm text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Versión Minecraft
                  </label>
                  <input
                    type="text"
                    required
                    value={mcVersion}
                    onChange={(e) => setMcVersion(e.target.value)}
                    placeholder="1.21.4"
                    className="w-full rounded-lg border border-[#334155] bg-[#0b1120] px-3 py-2 text-sm font-mono text-white focus:border-[#38bdf8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Mod Loader
                  </label>
                  <select
                    value={loader}
                    onChange={(e) =>
                      handleLoaderChange(e.target.value as ModLoaderKind)
                    }
                    className="w-full rounded-lg border border-[#334155] bg-[#0b1120] px-3 py-2 text-sm text-white focus:border-[#38bdf8] focus:outline-none"
                  >
                    <option value="vanilla">Vanilla</option>
                    <option value="fabric">Fabric</option>
                    <option value="forge">Forge</option>
                    <option value="neo_forge">NeoForge</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    RAM ({ramMb} MB)
                  </label>
                  <input
                    type="range"
                    min={1024}
                    max={hardware.max_safe_ram_mb}
                    step={512}
                    value={ramMb}
                    onChange={(e) => setRamMb(Number(e.target.value))}
                    className="w-full accent-[#38bdf8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Garbage Collector
                  </label>
                  <select
                    value={gcPreset}
                    onChange={(e) => setGcPreset(e.target.value as GcPreset)}
                    className="w-full rounded-lg border border-[#334155] bg-[#0b1120] px-3 py-2 text-sm text-white focus:border-[#38bdf8] focus:outline-none"
                  >
                    <option value="generational_zgc">Generational ZGC</option>
                    <option value="aikar_g1_gc">Aikar&apos;s G1GC</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1">
                  <Globe className="h-3.5 w-3.5 text-[#38bdf8]" />
                  Servidor Directo QuickPlay (Opcional)
                </label>
                <input
                  type="text"
                  value={serverAddress}
                  onChange={(e) => setServerAddress(e.target.value)}
                  placeholder="play.tuservidor.net:25565"
                  className="w-full rounded-lg border border-[#334155] bg-[#0b1120] px-3 py-2 text-sm font-mono text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-[#334155] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#1e293b]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[#10b981] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {saving ? "Creando..." : "Crear Perfil"}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
