import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  Gamepad2,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
  Volume2,
} from "lucide-react";
import { MinecraftSlider } from "./MinecraftSlider";
import { formatFriendlyError } from "../utils/errors";
import {
  browserKeyEventToMcKey,
  browserMouseButtonToMcKey,
  formatMcKeyLabel,
  KEYBIND_CATEGORIES,
  VANILLA_KEYBINDS,
} from "../utils/mcKeybinds";
import type {
  ApplyGlobalOptionsResult,
  GlobalGameOptions,
  Profile,
  SaveGlobalGameOptionsPayload,
} from "../types/launcher";

type ControlsSubTab = "audio" | "controls" | "camera";

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

const AUDIO_SUB_CHANNELS: { key: string; label: string; defaultPct: number }[] =
  [
    { key: "soundCategory_music", label: "Música", defaultPct: 50 },
    {
      key: "soundCategory_record",
      label: "Bloques musicales",
      defaultPct: 100,
    },
    { key: "soundCategory_weather", label: "Clima", defaultPct: 100 },
    { key: "soundCategory_block", label: "Bloques", defaultPct: 100 },
    {
      key: "soundCategory_hostile",
      label: "Criaturas hostiles",
      defaultPct: 100,
    },
    {
      key: "soundCategory_neutral",
      label: "Criaturas pacíficas",
      defaultPct: 100,
    },
    { key: "soundCategory_player", label: "Jugadores", defaultPct: 100 },
    {
      key: "soundCategory_ambient",
      label: "Ambiente / Entorno",
      defaultPct: 100,
    },
    { key: "soundCategory_voice", label: "Narrador / Voz", defaultPct: 100 },
  ];

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

const GUI_SCALE_OPTIONS = [
  { value: "0", label: "Automática" },
  { value: "1", label: "1 (Pequeña)" },
  { value: "2", label: "2 (Normal)" },
  { value: "3", label: "3 (Grande)" },
  { value: "4", label: "4 (Muy grande)" },
];

const NARRATOR_OPTIONS = [
  { value: "0", label: "Desactivado" },
  { value: "1", label: "Todo" },
  { value: "2", label: "Solo chat" },
  { value: "3", label: "Solo sistema" },
];

function mcFovToDegrees(raw?: string): number {
  const num = Number.parseFloat(raw ?? "0");
  if (!Number.isFinite(num)) return 70;
  return Math.round(Math.min(110, Math.max(30, 70 + num * 40)));
}

function degreesToMcFov(deg: number): string {
  return ((deg - 70) / 40).toFixed(4);
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

function parseWheelSensitivity(raw: string | undefined): number {
  const num = Number.parseFloat(raw ?? "1.0");
  if (!Number.isFinite(num)) return 100;
  return Math.round(Math.min(1000, Math.max(1, num * 100)));
}

function McToggleButton({
  label,
  valueLabel,
  active,
  onClick,
}: {
  label: string;
  valueLabel: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 w-full rounded-lg border px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
        active
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-white"
          : "border-white/[0.08] bg-[#0D1118] text-slate-300 hover:border-white/[0.16] hover:text-white"
      }`}
    >
      <span className="truncate">{label}:</span>
      <span
        className={`font-semibold shrink-0 ${
          active ? "text-[var(--accent-primary)]" : "text-slate-100"
        }`}
      >
        {valueLabel}
      </span>
    </button>
  );
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
  const [subTab, setSubTab] = useState<ControlsSubTab>("audio");
  const [sourceProfileId, setSourceProfileId] = useState(profile.id);
  const [autoApply, setAutoApply] = useState(true);
  const [hasSavedTemplate, setHasSavedTemplate] = useState(false);

  // Audio state (all 10 channels + subtitles + narrator)
  const [volumes, setVolumes] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = { soundCategory_master: 100 };
    for (const ch of AUDIO_SUB_CHANNELS) {
      init[ch.key] = ch.defaultPct;
    }
    return init;
  });
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [narrator, setNarrator] = useState("0");

  // Controls & Mouse state
  const [sensitivityPct, setSensitivityPct] = useState(100);
  const [wheelSensitivityPct, setWheelSensitivityPct] = useState(100);
  const [discreteScroll, setDiscreteScroll] = useState(false);
  const [invertY, setInvertY] = useState(false);
  const [rawMouseInput, setRawMouseInput] = useState(true);
  const [autoJump, setAutoJump] = useState(false);
  const [toggleSprint, setToggleSprint] = useState(false);
  const [toggleCrouch, setToggleCrouch] = useState(false);
  const [mainHand, setMainHand] = useState<"right" | "left">("right");
  const [keybinds, setKeybinds] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const kb of VANILLA_KEYBINDS) {
      init[kb.optionKey] = kb.defaultValue;
    }
    return init;
  });
  const [listeningKey, setListeningKey] = useState<string | null>(null);

  // Camera & Interface state
  const [fovDeg, setFovDeg] = useState(70);
  const [fovEffectScale, setFovEffectScale] = useState(100);
  const [screenEffectScale, setScreenEffectScale] = useState(100);
  const [darknessEffectScale, setDarknessEffectScale] = useState(100);
  const [bobView, setBobView] = useState(true);
  const [guiScale, setGuiScale] = useState("0");
  const [chatOpacity, setChatOpacity] = useState(100);
  const [chatScale, setChatScale] = useState(100);
  const [lang, setLang] = useState("es_es");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const hydrateFromData = useCallback((data: GlobalGameOptions) => {
    const e = data.entries;
    setHasSavedTemplate(Object.keys(e).length > 0);
    setAutoApply(data.auto_apply_on_new_instance);

    setVolumes(() => {
      const next: Record<string, number> = {
        soundCategory_master: parseUnitPercent(e["soundCategory_master"], 100),
      };
      for (const ch of AUDIO_SUB_CHANNELS) {
        next[ch.key] = parseUnitPercent(e[ch.key], ch.defaultPct);
      }
      return next;
    });
    setShowSubtitles((e["showSubtitles"] ?? "false") === "true");
    setNarrator(e["narrator"] ?? "0");

    setSensitivityPct(parseSensitivityPercent(e["mouseSensitivity"]));
    setWheelSensitivityPct(parseWheelSensitivity(e["mouseWheelSensitivity"]));
    setDiscreteScroll((e["discrete_mouse_scroll"] ?? "false") === "true");
    setInvertY((e["invertYMouse"] ?? "false") === "true");
    setRawMouseInput((e["rawMouseInput"] ?? "true") === "true");
    setAutoJump((e["autoJump"] ?? "false") === "true");
    setToggleSprint((e["toggleSprint"] ?? "false") === "true");
    setToggleCrouch((e["toggleCrouch"] ?? "false") === "true");
    setMainHand(e["mainHand"] === "left" ? "left" : "right");

    setKeybinds(() => {
      const next: Record<string, string> = {};
      for (const kb of VANILLA_KEYBINDS) {
        next[kb.optionKey] = e[kb.optionKey] ?? kb.defaultValue;
      }
      return next;
    });

    setFovDeg(mcFovToDegrees(e["fov"]));
    setFovEffectScale(parseUnitPercent(e["fovEffectScale"], 100));
    setScreenEffectScale(parseUnitPercent(e["screenEffectScale"], 100));
    setDarknessEffectScale(parseUnitPercent(e["darknessEffectScale"], 100));
    setBobView((e["bobView"] ?? "true") === "true");
    setGuiScale(e["guiScale"] ?? "0");
    setChatOpacity(parseUnitPercent(e["chatOpacity"], 100));
    setChatScale(parseUnitPercent(e["chatScale"], 100));
    setLang(e["lang"] ?? "es_es");
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

  // Interactive keyboard & mouse capture when listening for a keybind
  useEffect(() => {
    if (!listeningKey) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const mapped = browserKeyEventToMcKey(event);
      if (mapped) {
        setKeybinds((prev) => ({ ...prev, [listeningKey]: mapped }));
      }
      setListeningKey(null);
    };

    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const mapped = browserMouseButtonToMcKey(event.button);
      if (mapped) {
        setKeybinds((prev) => ({ ...prev, [listeningKey]: mapped }));
      }
      setListeningKey(null);
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [listeningKey]);

  const conflictCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const val of Object.values(keybinds)) {
      if (!val || val === "key.keyboard.unknown") continue;
      counts[val] = (counts[val] ?? 0) + 1;
    }
    return counts;
  }, [keybinds]);

  const buildPayloadEntries = (): Record<string, string> => {
    const entries: Record<string, string> = {
      soundCategory_master: ((volumes["soundCategory_master"] ?? 100) / 100).toFixed(2),
      showSubtitles: showSubtitles ? "true" : "false",
      narrator,
      mouseSensitivity: (sensitivityPct / 200).toFixed(4),
      mouseWheelSensitivity: (wheelSensitivityPct / 100).toFixed(2),
      discrete_mouse_scroll: discreteScroll ? "true" : "false",
      invertYMouse: invertY ? "true" : "false",
      rawMouseInput: rawMouseInput ? "true" : "false",
      autoJump: autoJump ? "true" : "false",
      toggleSprint: toggleSprint ? "true" : "false",
      toggleCrouch: toggleCrouch ? "true" : "false",
      mainHand,
      fov: degreesToMcFov(fovDeg),
      fovEffectScale: (fovEffectScale / 100).toFixed(2),
      screenEffectScale: (screenEffectScale / 100).toFixed(2),
      darknessEffectScale: (darknessEffectScale / 100).toFixed(2),
      bobView: bobView ? "true" : "false",
      guiScale,
      chatOpacity: (chatOpacity / 100).toFixed(2),
      chatScale: (chatScale / 100).toFixed(2),
      lang,
    };

    for (const ch of AUDIO_SUB_CHANNELS) {
      entries[ch.key] = ((volumes[ch.key] ?? ch.defaultPct) / 100).toFixed(2);
    }
    for (const kb of VANILLA_KEYBINDS) {
      entries[kb.optionKey] = keybinds[kb.optionKey] ?? kb.defaultValue;
    }
    return entries;
  };

  const handleImportFromInstance = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await onImportGlobalOptionsFromInstance(sourceProfileId);
      hydrateFromData(updated);
      setNotice({
        kind: "success",
        text: `Ajustes de sonido, controles y cámara importados desde "${updated.source_profile_name ?? sourceProfileId}".`,
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
        entries: buildPayloadEntries(),
      });
      hydrateFromData(updated);
      setNotice({
        kind: "success",
        text: "Preferencias globales guardadas correctamente.",
      });
    } catch (err) {
      setNotice({
        kind: "error",
        text: formatFriendlyError(
          err,
          "No se pudieron guardar tus preferencias globales.",
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
      await onSaveGlobalGameOptions({
        auto_apply_on_new_instance: autoApply,
        entries: buildPayloadEntries(),
      });
      await onApplyGlobalOptionsToInstance(profile.id);
      setHasSavedTemplate(true);
      setNotice({
        kind: "success",
        text: `Ajustes aplicados a "${profile.name}" (guardado con copia de seguridad automática).`,
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
      await onSaveGlobalGameOptions({
        auto_apply_on_new_instance: autoApply,
        entries: buildPayloadEntries(),
      });
      const res = await onApplyGlobalOptionsToAllInstances();
      setHasSavedTemplate(true);
      const skipTxt =
        res.skipped_running > 0
          ? ` (${res.skipped_running} omitida(s) por estar en juego)`
          : "";
      setNotice({
        kind: "success",
        text: `Ajustes aplicados a ${res.applied_instances} instancia(s) con copia de seguridad automática${skipTxt}.`,
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

  const formatAudioPct = (val: number) => (val === 0 ? "NO" : `${val}%`);
  const formatFovVal = (deg: number) =>
    deg === 70 ? "Normal (70°)" : deg === 110 ? "Quake Pro" : `${deg}°`;
  const formatSensVal = (pct: number) =>
    pct === 0
      ? "*bostezo*"
      : pct === 200
        ? "¡Hipervelocidad!"
        : `${pct}%`;

  const subTabs: { id: ControlsSubTab; label: string; icon: React.ReactNode }[] =
    [
      {
        id: "audio",
        label: "Música y Sonido",
        icon: <Volume2 className="h-3.5 w-3.5" />,
      },
      {
        id: "controls",
        label: "Controles y Ratón",
        icon: <Gamepad2 className="h-3.5 w-3.5" />,
      },
      {
        id: "camera",
        label: "Cámara e Interfaz",
        icon: <Eye className="h-3.5 w-3.5" />,
      },
    ];

  return (
    <section className="space-y-4">
      {/* Header + Import Bar */}
      <div className="rounded-xl forge-panel p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-[13px] font-semibold text-white">
            Ajustes de Juego Compartidos
          </h2>
          <p className="text-xs text-slate-400">
            Configura tu sonido, teclas y cámara una sola vez sin alterar los
            gráficos ni los packs de cada instancia.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={sourceProfileId}
            onChange={(e) => setSourceProfileId(e.target.value)}
            aria-label="Instancia origen"
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.08] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            Importar desde instancia
          </button>
        </div>
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

      {/* 3 Minecraft-Native Sub-Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-[#0D1118] border border-white/[0.06] p-1">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setListeningKey(null);
              setSubTab(t.id);
            }}
            className={`rounded-lg px-3.5 py-1.5 inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
              subTab === t.id
                ? "bg-[#121722] text-[var(--accent-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: MÚSICA Y SONIDO */}
      {subTab === "audio" && (
        <div className="rounded-xl forge-panel p-5 space-y-3">
          <MinecraftSlider
            label="Volumen general"
            value={volumes["soundCategory_master"] ?? 100}
            min={0}
            max={100}
            step={1}
            formatValue={formatAudioPct}
            onChange={(next) =>
              setVolumes((prev) => ({ ...prev, soundCategory_master: next }))
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {AUDIO_SUB_CHANNELS.map((ch) => (
              <MinecraftSlider
                key={ch.key}
                label={ch.label}
                value={volumes[ch.key] ?? ch.defaultPct}
                min={0}
                max={100}
                step={1}
                formatValue={formatAudioPct}
                onChange={(next) =>
                  setVolumes((prev) => ({ ...prev, [ch.key]: next }))
                }
              />
            ))}

            <McToggleButton
              label="Mostrar subtítulos"
              valueLabel={showSubtitles ? "Sí" : "No"}
              active={showSubtitles}
              onClick={() => setShowSubtitles((v) => !v)}
            />
          </div>

          <div className="pt-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="h-10 rounded-lg border border-white/[0.08] bg-[#0D1118] px-3 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">
                Narrador
              </span>
              <select
                value={narrator}
                onChange={(e) => setNarrator(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none"
              >
                {NARRATOR_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    className="bg-[#0D1118] text-white"
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: CONTROLES Y RATÓN */}
      {subTab === "controls" && (
        <div className="space-y-4">
          {/* Mouse & Movement block */}
          <div className="rounded-xl forge-panel p-5 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <MinecraftSlider
                label="Sensibilidad"
                value={sensitivityPct}
                min={0}
                max={200}
                step={1}
                formatValue={formatSensVal}
                onChange={setSensitivityPct}
              />
              <MinecraftSlider
                label="Sensibilidad de rueda"
                value={wheelSensitivityPct}
                min={10}
                max={500}
                step={1}
                formatValue={(v) => `${(v / 100).toFixed(2)}×`}
                onChange={setWheelSensitivityPct}
              />
              <McToggleButton
                label="Invertir eje Y"
                valueLabel={invertY ? "Sí" : "No"}
                active={invertY}
                onClick={() => setInvertY((v) => !v)}
              />
              <McToggleButton
                label="Entrada directa"
                valueLabel={rawMouseInput ? "Sí" : "No"}
                active={rawMouseInput}
                onClick={() => setRawMouseInput((v) => !v)}
              />
              <McToggleButton
                label="Desplazamiento discreto"
                valueLabel={discreteScroll ? "Sí" : "No"}
                active={discreteScroll}
                onClick={() => setDiscreteScroll((v) => !v)}
              />
              <McToggleButton
                label="Mano principal"
                valueLabel={mainHand === "left" ? "Izquierda" : "Derecha"}
                active={mainHand === "left"}
                onClick={() =>
                  setMainHand((m) => (m === "right" ? "left" : "right"))
                }
              />
              <McToggleButton
                label="Auto-salto"
                valueLabel={autoJump ? "Sí" : "No"}
                active={autoJump}
                onClick={() => setAutoJump((v) => !v)}
              />
              <McToggleButton
                label="Correr"
                valueLabel={toggleSprint ? "Alternar" : "Mantener"}
                active={toggleSprint}
                onClick={() => setToggleSprint((v) => !v)}
              />
              <McToggleButton
                label="Agacharse"
                valueLabel={toggleCrouch ? "Alternar" : "Mantener"}
                active={toggleCrouch}
                onClick={() => setToggleCrouch((v) => !v)}
              />
            </div>
          </div>

          {/* Interactive Keybinds grouped by vanilla category */}
          <div className="rounded-xl forge-panel p-5 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold text-white">
                  Asignación de teclas
                </h3>
                <p className="text-xs text-slate-400">
                  Haz clic en cualquier botón y pulsa una tecla o botón del
                  ratón (Esc para dejar sin asignar).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const defaults: Record<string, string> = {};
                  for (const kb of VANILLA_KEYBINDS) {
                    defaults[kb.optionKey] = kb.defaultValue;
                  }
                  setKeybinds(defaults);
                  setListeningKey(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors shrink-0"
              >
                <RotateCcw className="h-3 w-3" />
                Restablecer todas
              </button>
            </div>

            {KEYBIND_CATEGORIES.map((cat) => {
              const items = VANILLA_KEYBINDS.filter(
                (kb) => kb.category === cat.id,
              );
              return (
                <div key={cat.id} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 border-b border-white/[0.06] pb-1">
                    {cat.title}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {items.map((kb) => {
                      const currentVal =
                        keybinds[kb.optionKey] ?? kb.defaultValue;
                      const isListening = listeningKey === kb.optionKey;
                      const hasConflict =
                        currentVal !== "key.keyboard.unknown" &&
                        (conflictCounts[currentVal] ?? 0) > 1;
                      const isModified = currentVal !== kb.defaultValue;

                      return (
                        <div
                          key={kb.optionKey}
                          className="flex items-center justify-between gap-2 rounded-lg bg-[#080B10] border border-white/[0.05] px-3 py-1.5"
                        >
                          <span className="text-xs text-slate-200 truncate">
                            {kb.label}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setListeningKey(
                                  isListening ? null : kb.optionKey,
                                )
                              }
                              className={`min-w-[116px] h-7 rounded-md border px-2 font-mono text-[11px] font-semibold transition-colors ${
                                isListening
                                  ? "border-amber-400 bg-amber-500/15 text-amber-200 animate-pulse"
                                  : hasConflict
                                    ? "border-rose-500/60 bg-rose-500/15 text-rose-200"
                                    : "border-white/[0.1] bg-[#121722] text-slate-100 hover:border-[var(--accent-primary)]"
                              }`}
                            >
                              {isListening
                                ? "> Pulsa tecla <"
                                : formatMcKeyLabel(currentVal)}
                            </button>
                            <button
                              type="button"
                              disabled={!isModified}
                              title="Restablecer tecla"
                              onClick={() =>
                                setKeybinds((prev) => ({
                                  ...prev,
                                  [kb.optionKey]: kb.defaultValue,
                                }))
                              }
                              className="h-7 w-7 rounded-md border border-white/[0.07] bg-[#0D1118] hover:bg-white/[0.06] disabled:opacity-30 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: CÁMARA E INTERFAZ */}
      {subTab === "camera" && (
        <div className="rounded-xl forge-panel p-5 space-y-3">
          <MinecraftSlider
            label="Campo de visión (FOV)"
            value={fovDeg}
            min={30}
            max={110}
            step={1}
            formatValue={formatFovVal}
            onChange={setFovDeg}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <MinecraftSlider
              label="Efectos de FOV"
              value={fovEffectScale}
              min={0}
              max={100}
              step={1}
              formatValue={formatAudioPct}
              onChange={setFovEffectScale}
            />
            <MinecraftSlider
              label="Efectos de distorsión"
              value={screenEffectScale}
              min={0}
              max={100}
              step={1}
              formatValue={formatAudioPct}
              onChange={setScreenEffectScale}
            />
            <MinecraftSlider
              label="Oscuridad ambiental"
              value={darknessEffectScale}
              min={0}
              max={100}
              step={1}
              formatValue={formatAudioPct}
              onChange={setDarknessEffectScale}
            />
            <McToggleButton
              label="Balanceo al caminar"
              valueLabel={bobView ? "Sí" : "No"}
              active={bobView}
              onClick={() => setBobView((v) => !v)}
            />
            <MinecraftSlider
              label="Opacidad del chat"
              value={chatOpacity}
              min={0}
              max={100}
              step={1}
              formatValue={formatAudioPct}
              onChange={setChatOpacity}
            />
            <MinecraftSlider
              label="Escala del chat"
              value={chatScale}
              min={0}
              max={100}
              step={1}
              formatValue={formatAudioPct}
              onChange={setChatScale}
            />

            <div className="h-10 rounded-lg border border-white/[0.08] bg-[#0D1118] px-3 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">
                Escala de interfaz
              </span>
              <select
                value={guiScale}
                onChange={(e) => setGuiScale(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none"
              >
                {GUI_SCALE_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    className="bg-[#0D1118] text-white"
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="h-10 rounded-lg border border-white/[0.08] bg-[#0D1118] px-3 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">
                Idioma de Minecraft
              </span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none"
              >
                {LANG_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    className="bg-[#0D1118] text-white"
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions: Auto-apply, Save & Apply */}
      <div className="rounded-xl forge-panel px-5 py-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => setAutoApply(e.target.checked)}
              className="accent-[var(--accent-primary)] h-4 w-4"
            />
            <span className="text-xs text-slate-200">
              Aplicar automáticamente al crear nuevas instancias o importar
              modpacks
            </span>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSaveTemplate()}
            className="btn-accent rounded-lg px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            <Save className="h-3.5 w-3.5" />
            Guardar preferencias
          </button>
        </div>

        <div className="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {hasSavedTemplate
              ? "Cada aplicación guarda una copia de seguridad automática antes de actualizar la instancia."
              : "Guarda o importa tus preferencias para aplicarlas a tus instancias."}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || isProfileRunning}
              onClick={() => void handleApplyCurrent()}
              className="rounded-lg bg-[#121722] hover:bg-[#171D2B] border border-white/[0.08] disabled:opacity-45 px-3 py-1.5 text-xs font-medium text-slate-100 inline-flex items-center gap-1.5 transition-colors"
            >
              <Sliders className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              Aplicar a esta instancia
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleApplyAll()}
              className="rounded-lg bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-45 px-3 py-1.5 text-xs font-medium text-[var(--accent-primary)] inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Aplicar a todas las cerradas
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
