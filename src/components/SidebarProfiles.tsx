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
  vanilla: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  fabric: "bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/25",
  forge: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  neo_forge: "bg-orange-500/10 text-orange-300 border-orange-500/25",
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
    <aside className="w-[272px] shrink-0 bg-[#0e121a] border-r border-white/[0.07] flex flex-col select-none">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Instancias
          </span>
          <span className="rounded-md bg-white/[0.05] border border-white/[0.07] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
            {profiles.length}
          </span>
        </div>

        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-[#38bdf8]" />
          Nuevo
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1.5">
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
              className={`group relative rounded-xl p-3 cursor-pointer transition-all ${
                isSelected
                  ? "bg-[rgba(22,28,42,0.88)] border border-white/[0.11] obsidian-inset"
                  : "bg-transparent border border-transparent hover:bg-white/[0.03] hover:border-white/[0.06]"
              }`}
            >
              {isSelected && (
                <span className="absolute left-0 top-3 bottom-3 w-[2.5px] rounded-r-full bg-[#38bdf8]" />
              )}

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 pl-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-[13px] font-semibold tracking-tight ${
                        isSelected ? "text-white" : "text-slate-300"
                      }`}
                    >
                      {profile.name}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[#090b10] border border-white/[0.07] px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                      {profile.mc_version}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-mono font-medium ${LOADER_BADGE_STYLES[profile.loader]}`}
                    >
                      {LOADER_LABELS[profile.loader]}
                    </span>
                    {profile.is_default && (
                      <span className="text-[10px] font-mono text-[#10b981]">
                        ● default
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    title="Marcar como perfil por defecto"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onSetDefault(profile.id);
                    }}
                    className={`p-1 rounded-md hover:bg-white/[0.06] transition-colors ${
                      profile.is_default
                        ? "text-[#10b981]"
                        : "text-slate-600 hover:text-slate-300"
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
                      title="Quitar perfil"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteProfile(profile.id);
                      }}
                      className="p-1 rounded-md text-slate-600 hover:text-rose-400 hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 pl-1 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>{profile.ram_mb} MB</span>
                {profile.server_address && (
                  <span className="inline-flex items-center gap-1 text-[#38bdf8] truncate max-w-[140px]">
                    <Server className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{profile.server_address}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-white/[0.07] bg-[#090b10]/60">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-[#38bdf8]/10 border border-[#38bdf8]/20 flex items-center justify-center text-[#38bdf8] shrink-0">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-300 truncate">
              Host Telemetry
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              {Math.round(hardware.total_ram_mb / 1024)} GB RAM ·{" "}
              {hardware.logical_cores} threads
            </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-2xl obsidian-card p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Nueva Instancia Aislada
                </h2>
                <p className="text-[11px] text-slate-400">
                  Comparte assets/librerías · Aísla mods y configuración
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Nombre de la Instancia
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Survival 1.21.4 Fabric"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-[#38bdf8] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Versión MC
                  </label>
                  <input
                    type="text"
                    required
                    value={mcVersion}
                    onChange={(e) => setMcVersion(e.target.value)}
                    placeholder="1.21.4"
                    className="w-full rounded-lg border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs font-mono text-white focus:border-[#38bdf8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Mod Loader
                  </label>
                  <select
                    value={loader}
                    onChange={(e) =>
                      handleLoaderChange(e.target.value as ModLoaderKind)
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
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
                  <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                    Heap RAM{" "}
                    <span className="font-mono text-[#38bdf8]">
                      {ramMb} MB
                    </span>
                  </label>
                  <input
                    type="range"
                    min={1024}
                    max={hardware.max_safe_ram_mb}
                    step={512}
                    value={ramMb}
                    onChange={(e) => setRamMb(Number(e.target.value))}
                    className="w-full obsidian-slider"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Garbage Collector
                  </label>
                  <select
                    value={gcPreset}
                    onChange={(e) => setGcPreset(e.target.value as GcPreset)}
                    className="w-full rounded-lg border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                  >
                    <option value="generational_zgc">Generational ZGC</option>
                    <option value="aikar_g1_gc">Aikar&apos;s G1GC</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300 mb-1">
                  <Globe className="h-3 w-3 text-[#38bdf8]" />
                  QuickPlay Direct Server (Opcional)
                </label>
                <input
                  type="text"
                  value={serverAddress}
                  onChange={(e) => setServerAddress(e.target.value)}
                  placeholder="play.servidor.net:25565"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-white/[0.08] px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.05]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[#10b981] hover:bg-[#059669] px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50 transition-colors"
              >
                {saving ? "Creando..." : "Crear Instancia"}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
