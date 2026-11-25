import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Gamepad2,
  RefreshCw,
  Save,
  Sliders,
} from "lucide-react";
import { formatFriendlyError } from "../utils/errors";
import type {
  ApplyGlobalOptionsResult,
  GlobalGameOptions,
  Profile,
  SaveGlobalGameOptionsPayload,
} from "../types/launcher";

interface GlobalOptionsSectionProps {
  profile: Profile;
  profiles: Profile[];
  isProfileRunning: boolean;
  onGetGlobalGameOptions: () => Promise<GlobalGameOptions>;
  onSaveGlobalGameOptions: (
    payload: SaveGlobalGameOptionsPayload,
  ) => Promise<GlobalGameOptions>;
  onImportGlobalOptionsFromInstance: (
    profileId: string,
  ) => Promise<GlobalGameOptions>;
  onApplyGlobalOptionsToInstance: (
    profileId: string,
  ) => Promise<ApplyGlobalOptionsResult>;
  onApplyGlobalOptionsToAllInstances: () => Promise<ApplyGlobalOptionsResult>;
}

const LANG_OPTIONS = [
  { value: "es_es", label: "Español (España)" },
  { value: "es_mx", label: "Español (México)" },
  { value: "es_ar", label: "Español (Argentina)" },
  { value: "en_us", label: "English (US)" },
  { value: "en_gb", label: "English (UK)" },
  { value: "pt_br", label: "Português (Brasil)" },
  { value: "fr_fr", label: "Français" },
  { value: "de_de", label: "Deutsch" },
];

function mcFovToDegrees(raw?: string): number {
  const num = Number.parseFloat(raw ?? "0");
  if (!Number.isFinite(num)) return 70;
  return Math.round(Math.min(110, Math.max(30, 70 + num * 40)));
}

function degreesToMcFov(deg: number): string {
  return ((deg - 70) / 40).toFixed(2);
}

function parseUnitPercent(raw: string | undefined, fallback: number): number {
  const num = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.min(100, Math.max(0, num * 100)));
}

function parseSensitivityPercent(raw: string | undefined): number {
  const num = Number.parseFloat(raw ?? "0.5");
  if (!Number.isFinite(num)) return 100;
  return Math.round(Math.min(200, Math.max(0, num * 200)));
}

export function GlobalOptionsSection({
  profile,
  profiles,
  isProfileRunning,
  onGetGlobalGameOptions,
  onSaveGlobalGameOptions,
  onImportGlobalOptionsFromInstance,
  onApplyGlobalOptionsToInstance,
  onApplyGlobalOptionsToAllInstances,
}: GlobalOptionsSectionProps) {
  const [opts, setOpts] = useState<GlobalGameOptions | null>(null);
  const [sourceProfileId, setSourceProfileId] = useState(profile.id);
  const [autoApply, setAutoApply] = useState(true);
  const [fovDeg, setFovDeg] = useState(70);
  const [sensitivityPct, setSensitivityPct] = useState(100);
  const [masterVol, setMasterVol] = useState(100);
  const [musicVol, setMusicVol] = useState(50);
  const [lang, setLang] = useState("es_es");
  const [autoJump, setAutoJump] = useState(false);
  const [toggleSprint, setToggleSprint] = useState(false);
  const [toggleCrouch, setToggleCrouch] = useState(false);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const hydrateFromData = useCallback((data: GlobalGameOptions) => {
    setOpts(data);
    setAutoApply(data.auto_apply_on_new_instance);
    setFovDeg(mcFovToDegrees(data.entries["fov"]));
    setSensitivityPct(parseSensitivityPercent(data.entries["mouseSensitivity"]));
    setMasterVol(parseUnitPercent(data.entries["soundCategory_master"], 100));
    setMusicVol(parseUnitPercent(data.entries["soundCategory_music"], 50));
    setLang(data.entries["lang"] ?? "es_es");
    setAutoJump((data.entries["autoJump"] ?? "false") === "true");
    setToggleSprint((data.entries["toggleSprint"] ?? "false") === "true");
    setToggleCrouch((data.entries["toggleCrouch"] ?? "false") === "true");
  }, []);

  useEffect(() => {
    setSourceProfileId(profile.id);
  }, [profile.id]);

  useEffect(() => {
    let cancelled = false;
    void onGetGlobalGameOptions()
      .then((data) => {
        if (!cancelled) hydrateFromData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hydrateFromData, onGetGlobalGameOptions]);

  const handleImportFromInstance = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await onImportGlobalOptionsFromInstance(sourceProfileId);
      hydrateFromData(updated);
      const totalKeys = Object.keys(updated.entries).length;
      setNotice({
        kind: "success",
        text: `Importados ${totalKeys} ajustes portables (${updated.custom_keybinds_count} controles) desde "${updated.source_profile_name ?? sourceProfileId}".`,
      });
    } catch (err) {
      setNotice({
        kind: "error",
        text: formatFriendlyError(
          err,
          "No se pudieron importar los ajustes de esa instancia.",
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTemplate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await onSaveGlobalGameOptions({
        auto_apply_on_new_instance: autoApply,
        entries: {
          fov: degreesToMcFov(fovDeg),
          mouseSensitivity: (sensitivityPct / 200).toFixed(4),
          soundCategory_master: (masterVol / 100).toFixed(2),
          soundCategory_music: (musicVol / 100).toFixed(2),
          lang,
          autoJump: autoJump ? "true" : "false",
          toggleSprint: toggleSprint ? "true" : "false",
          toggleCrouch: toggleCrouch ? "true" : "false",
        },
      });
      hydrateFromData(updated);
      setNotice({
        kind: "success",
        text: "Plantilla global de controles y juego guardada.",
      });
    } catch (err) {
      setNotice({
        kind: "error",
        text: formatFriendlyError(
          err,
          "No se pudo guardar la plantilla global.",
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApplyCurrent = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await onApplyGlobalOptionsToInstance(profile.id);
      setNotice({
        kind: "success",
        text:
          res.backups_created.length > 0
            ? `Ajustes aplicados a "${profile.name}" (respaldo guardado en ${res.backups_created[0]}).`
            : `Ajustes aplicados a "${profile.name}".`,
      });
    } catch (err) {
      setNotice({
        kind: "error",
        text: formatFriendlyError(
          err,
          "No se pudieron aplicar los ajustes a esta instancia.",
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApplyAll = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await onApplyGlobalOptionsToAllInstances();
      const skipTxt =
        res.skipped_running > 0
          ? ` (${res.skipped_running} omitida(s) por estar abiertas)`
          : "";
      setNotice({
        kind: "success",
        text: `Ajustes aplicados a ${res.applied_instances} instancia(s)${skipTxt}.`,
      });
    } catch (err) {
      setNotice({
        kind: "error",
        text: formatFriendlyError(
          err,
          "No se pudieron aplicar los ajustes globales.",
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const keybindsCount = opts?.custom_keybinds_count ?? 0;
  const totalSavedKeys = opts ? Object.keys(opts.entries).length : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Centralizador de Controles y Juego
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Guarda tus teclas, cámara, audio e idioma una sola vez y aplícalos
            sin tocar gráficos ni resource packs de cada instancia.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--accent-soft)] border border-[var(--accent-border)] px-2.5 py-0.5 text-[11px] font-mono text-[var(--accent-primary)]">
          {keybindsCount} controles guardados
        </span>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2 ${
            notice.kind === "error"
              ? "bg-rose-500/10 border-rose-500/35 text-rose-200"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
          }`}
        >
          {notice.kind === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Import from an existing configured instance */}
      <div className="rounded-xl forge-panel p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-[13px] font-medium text-white flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            Importar desde una instancia ya configurada
          </div>
          <p className="text-xs text-slate-400">
            Copia tus teclas, sensibilidad, FOV, audio e idioma desde el{" "}
            <code className="font-mono text-slate-300">options.txt</code> de una
            instancia existente.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={sourceProfileId}
            onChange={(e) => setSourceProfileId(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-[#07090D] px-2.5 py-1.5 text-xs text-white focus:border-[var(--accent-primary)] focus:outline-none"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.mc_version})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleImportFromInstance()}
            className="rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.08] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors"
          >
            Importar
          </button>
        </div>
      </div>

      {/* Quick Editable Visual Controls */}
      <div className="rounded-xl forge-panel divide-y divide-white/[0.05]">
        <div className="px-5 py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Campo de visión (FOV)</span>
              <span className="font-mono text-[var(--accent-primary)]">
                {fovDeg}°
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={110}
              step={1}
              value={fovDeg}
              onChange={(e) => setFovDeg(Number(e.target.value))}
              className="w-full forge-slider"
            />
          </label>

          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Sensibilidad del ratón</span>
              <span className="font-mono text-[var(--accent-primary)]">
                {sensitivityPct}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={sensitivityPct}
              onChange={(e) => setSensitivityPct(Number(e.target.value))}
              className="w-full forge-slider"
            />
          </label>

          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Volumen general</span>
              <span className="font-mono text-[var(--accent-primary)]">
                {masterVol}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={masterVol}
              onChange={(e) => setMasterVol(Number(e.target.value))}
              className="w-full forge-slider"
            />
          </label>

          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Volumen de música</span>
              <span className="font-mono text-[var(--accent-primary)]">
                {musicVol}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={musicVol}
              onChange={(e) => setMusicVol(Number(e.target.value))}
              className="w-full forge-slider"
            />
          </label>
        </div>

        <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-slate-100">
              Idioma de Minecraft
            </div>
            <p className="text-xs text-slate-400">
              Idioma por defecto para menús y objetos del juego.
            </p>
          </div>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-[#07090D] px-3 py-1.5 text-xs text-white focus:border-[var(--accent-primary)] focus:outline-none sm:w-56"
          >
            {LANG_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="px-5 py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              label: "Auto-salto",
              checked: autoJump,
              onChange: setAutoJump,
            },
            {
              label: "Correr con un toque",
              checked: toggleSprint,
              onChange: setToggleSprint,
            },
            {
              label: "Agacharse con un toque",
              checked: toggleCrouch,
              onChange: setToggleCrouch,
            },
          ].map((item) => (
            <label
              key={item.label}
              className="flex items-center justify-between gap-2 rounded-lg bg-[#07090D] border border-white/[0.06] px-3 py-2 cursor-pointer"
            >
              <span className="text-xs text-slate-200">{item.label}</span>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => item.onChange(e.target.checked)}
                className="accent-[var(--accent-primary)] h-3.5 w-3.5"
              />
            </label>
          ))}
        </div>

        <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => setAutoApply(e.target.checked)}
              className="accent-[var(--accent-primary)] h-4 w-4"
            />
            <span className="text-xs text-slate-200">
              Aplicar automáticamente al crear nuevas instancias o importar{" "}
              <code className="font-mono text-slate-300">.mrpack</code>
            </span>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSaveTemplate()}
            className="btn-accent rounded-lg px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            <Save className="h-3.5 w-3.5" />
            Guardar plantilla
          </button>
        </div>
      </div>

      {/* Apply actions */}
      <div className="rounded-xl forge-panel px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <Gamepad2 className="h-4 w-4 text-[var(--accent-primary)] shrink-0" />
          <span>
            {totalSavedKeys > 0
              ? `Plantilla lista (${totalSavedKeys} claves). Se crea copia .bak antes de modificar cualquier instancia.`
              : "Guarda o importa una plantilla para poder aplicarla a tus instancias."}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || totalSavedKeys === 0 || isProfileRunning}
            onClick={() => void handleApplyCurrent()}
            className="rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.08] disabled:opacity-45 px-3 py-1.5 text-xs font-medium text-slate-100 inline-flex items-center gap-1.5 transition-colors"
          >
            <Sliders className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            Aplicar a esta instancia
          </button>
          <button
            type="button"
            disabled={busy || totalSavedKeys === 0}
            onClick={() => void handleApplyAll()}
            className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-45 px-3 py-1.5 text-xs font-medium text-[var(--accent-primary)] inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Aplicar a todas las cerradas
          </button>
        </div>
      </div>
    </section>
  );
}
