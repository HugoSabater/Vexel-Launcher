export interface VanillaKeybindDef {
  optionKey: string;
  label: string;
  defaultValue: string;
  category: "movement" | "gameplay" | "inventory" | "misc";
}

export const KEYBIND_CATEGORIES: {
  id: VanillaKeybindDef["category"];
  title: string;
}[] = [
  { id: "movement", title: "Movimiento" },
  { id: "gameplay", title: "Juego" },
  { id: "inventory", title: "Inventario" },
  { id: "misc", title: "Varios" },
];

export const VANILLA_KEYBINDS: VanillaKeybindDef[] = [
  // Movimiento
  {
    optionKey: "key_key.forward",
    label: "Avanzar",
    defaultValue: "key.keyboard.w",
    category: "movement",
  },
  {
    optionKey: "key_key.back",
    label: "Retroceder",
    defaultValue: "key.keyboard.s",
    category: "movement",
  },
  {
    optionKey: "key_key.left",
    label: "Izquierda",
    defaultValue: "key.keyboard.a",
    category: "movement",
  },
  {
    optionKey: "key_key.right",
    label: "Derecha",
    defaultValue: "key.keyboard.d",
    category: "movement",
  },
  {
    optionKey: "key_key.jump",
    label: "Saltar",
    defaultValue: "key.keyboard.space",
    category: "movement",
  },
  {
    optionKey: "key_key.sneak",
    label: "Agacharse",
    defaultValue: "key.keyboard.left.shift",
    category: "movement",
  },
  {
    optionKey: "key_key.sprint",
    label: "Correr",
    defaultValue: "key.keyboard.left.control",
    category: "movement",
  },

  // Juego
  {
    optionKey: "key_key.attack",
    label: "Atacar / Destruir",
    defaultValue: "key.mouse.left",
    category: "gameplay",
  },
  {
    optionKey: "key_key.use",
    label: "Usar objeto / Colocar",
    defaultValue: "key.mouse.right",
    category: "gameplay",
  },
  {
    optionKey: "key_key.pickItem",
    label: "Elegir bloque",
    defaultValue: "key.mouse.middle",
    category: "gameplay",
  },

  // Inventario
  {
    optionKey: "key_key.inventory",
    label: "Inventario",
    defaultValue: "key.keyboard.e",
    category: "inventory",
  },
  {
    optionKey: "key_key.drop",
    label: "Soltar objeto",
    defaultValue: "key.keyboard.q",
    category: "inventory",
  },
  {
    optionKey: "key_key.swapOffhand",
    label: "Cambiar mano",
    defaultValue: "key.keyboard.f",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.1",
    label: "Ranura 1",
    defaultValue: "key.keyboard.1",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.2",
    label: "Ranura 2",
    defaultValue: "key.keyboard.2",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.3",
    label: "Ranura 3",
    defaultValue: "key.keyboard.3",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.4",
    label: "Ranura 4",
    defaultValue: "key.keyboard.4",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.5",
    label: "Ranura 5",
    defaultValue: "key.keyboard.5",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.6",
    label: "Ranura 6",
    defaultValue: "key.keyboard.6",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.7",
    label: "Ranura 7",
    defaultValue: "key.keyboard.7",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.8",
    label: "Ranura 8",
    defaultValue: "key.keyboard.8",
    category: "inventory",
  },
  {
    optionKey: "key_key.hotbar.9",
    label: "Ranura 9",
    defaultValue: "key.keyboard.9",
    category: "inventory",
  },

  // Varios
  {
    optionKey: "key_key.playerlist",
    label: "Lista de jugadores",
    defaultValue: "key.keyboard.tab",
    category: "misc",
  },
  {
    optionKey: "key_key.chat",
    label: "Abrir chat",
    defaultValue: "key.keyboard.t",
    category: "misc",
  },
  {
    optionKey: "key_key.togglePerspective",
    label: "Cambiar perspectiva",
    defaultValue: "key.keyboard.f5",
    category: "misc",
  },
];

const SPECIAL_CODE_MAP: Record<string, string> = {
  Space: "key.keyboard.space",
  ShiftLeft: "key.keyboard.left.shift",
  ShiftRight: "key.keyboard.right.shift",
  ControlLeft: "key.keyboard.left.control",
  ControlRight: "key.keyboard.right.control",
  AltLeft: "key.keyboard.left.alt",
  AltRight: "key.keyboard.right.alt",
  Tab: "key.keyboard.tab",
  Enter: "key.keyboard.enter",
  NumpadEnter: "key.keyboard.keypad.enter",
  Backspace: "key.keyboard.backspace",
  CapsLock: "key.keyboard.caps.lock",
  ArrowUp: "key.keyboard.up",
  ArrowDown: "key.keyboard.down",
  ArrowLeft: "key.keyboard.left",
  ArrowRight: "key.keyboard.right",
  Insert: "key.keyboard.insert",
  Delete: "key.keyboard.delete",
  Home: "key.keyboard.home",
  End: "key.keyboard.end",
  PageUp: "key.keyboard.page.up",
  PageDown: "key.keyboard.page.down",
  Minus: "key.keyboard.minus",
  Equal: "key.keyboard.equal",
  BracketLeft: "key.keyboard.left.bracket",
  BracketRight: "key.keyboard.right.bracket",
  Backslash: "key.keyboard.backslash",
  Semicolon: "key.keyboard.semicolon",
  Quote: "key.keyboard.apostrophe",
  Backquote: "key.keyboard.grave.accent",
  Comma: "key.keyboard.comma",
  Period: "key.keyboard.period",
  Slash: "key.keyboard.slash",
};

export function browserKeyEventToMcKey(event: KeyboardEvent): string | null {
  if (event.code === "Escape") {
    return "key.keyboard.unknown";
  }
  if (SPECIAL_CODE_MAP[event.code]) {
    return SPECIAL_CODE_MAP[event.code];
  }
  if (event.code.startsWith("Key") && event.code.length === 4) {
    return `key.keyboard.${event.code.slice(3).toLowerCase()}`;
  }
  if (event.code.startsWith("Digit") && event.code.length === 6) {
    return `key.keyboard.${event.code.slice(5)}`;
  }
  if (/^F([1-9]|1[0-2])$/.test(event.code)) {
    return `key.keyboard.${event.code.toLowerCase()}`;
  }
  if (event.code.startsWith("Numpad") && event.code.length === 7) {
    return `key.keyboard.keypad.${event.code.slice(6)}`;
  }
  return null;
}

export function browserMouseButtonToMcKey(button: number): string | null {
  switch (button) {
    case 0:
      return "key.mouse.left";
    case 1:
      return "key.mouse.middle";
    case 2:
      return "key.mouse.right";
    case 3:
      return "key.mouse.4";
    case 4:
      return "key.mouse.5";
    default:
      return null;
  }
}

const DISPLAY_LABELS: Record<string, string> = {
  "key.keyboard.unknown": "Sin asignar",
  "key.keyboard.space": "Espacio",
  "key.keyboard.left.shift": "Mayús Izq.",
  "key.keyboard.right.shift": "Mayús Der.",
  "key.keyboard.left.control": "Ctrl Izq.",
  "key.keyboard.right.control": "Ctrl Der.",
  "key.keyboard.left.alt": "Alt Izq.",
  "key.keyboard.right.alt": "Alt Gr",
  "key.keyboard.tab": "Tab",
  "key.keyboard.enter": "Intro",
  "key.keyboard.backspace": "Retroceso",
  "key.keyboard.caps.lock": "Bloq Mayús",
  "key.keyboard.up": "↑",
  "key.keyboard.down": "↓",
  "key.keyboard.left": "←",
  "key.keyboard.right": "→",
  "key.keyboard.grave.accent": "º / `",
  "key.mouse.left": "Clic Izq.",
  "key.mouse.right": "Clic Der.",
  "key.mouse.middle": "Clic Central",
  "key.mouse.4": "Ratón 4",
  "key.mouse.5": "Ratón 5",
};

export function formatMcKeyLabel(mcKey: string): string {
  if (DISPLAY_LABELS[mcKey]) return DISPLAY_LABELS[mcKey];
  if (mcKey.startsWith("key.keyboard.keypad.")) {
    return `Num ${mcKey.slice("key.keyboard.keypad.".length).toUpperCase()}`;
  }
  if (mcKey.startsWith("key.keyboard.")) {
    return mcKey.slice("key.keyboard.".length).toUpperCase();
  }
  if (mcKey.startsWith("key.mouse.")) {
    return `Ratón ${mcKey.slice("key.mouse.".length)}`;
  }
  return mcKey;
}
