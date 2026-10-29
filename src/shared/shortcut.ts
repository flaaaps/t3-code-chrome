/**
 * Parse the shortcut string Chrome reports for a command ("⌥⇧G" on macOS, "Alt+Shift+G" elsewhere)
 * and match it against keyboard events. Used as an in-page fallback for browsers that do not
 * deliver extension commands reliably.
 */
export interface ParsedShortcut {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  key: string;
}

const MAC_SYMBOLS: Record<string, keyof Omit<ParsedShortcut, "key">> = {
  "⌥": "alt",
  "⇧": "shift",
  "⌃": "ctrl",
  "⌘": "meta",
};

export function parseShortcut(text: string | undefined | null): ParsedShortcut | undefined {
  const value = (text ?? "").trim();
  if (!value) return undefined;
  const result: ParsedShortcut = { alt: false, shift: false, ctrl: false, meta: false, key: "" };
  if (value.includes("+")) {
    const parts = value.split("+").map((part) => part.trim());
    const key = parts.pop();
    for (const part of parts) {
      const name = part.toLowerCase();
      if (name === "alt" || name === "option") result.alt = true;
      else if (name === "shift") result.shift = true;
      else if (name === "ctrl" || name === "macctrl") result.ctrl = true;
      else if (name === "command" || name === "cmd" || name === "meta") result.meta = true;
      else return undefined;
    }
    result.key = (key ?? "").toUpperCase();
  } else {
    let rest = value;
    while (rest.length > 1 && MAC_SYMBOLS[rest[0] ?? ""]) {
      const modifier = MAC_SYMBOLS[rest[0] ?? ""];
      if (modifier) result[modifier] = true;
      rest = rest.slice(1);
    }
    result.key = rest.toUpperCase();
  }
  if (!result.key) return undefined;
  if (!result.alt && !result.ctrl && !result.meta) return undefined;
  return result;
}

interface KeyLike {
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  code: string;
  key: string;
}

/** Compare by physical key (`code`), since Option changes `key` on macOS (⌥⇧G types "˝"). */
export function matchesShortcut(event: KeyLike, shortcut: ParsedShortcut | undefined): boolean {
  if (!shortcut) return false;
  if (
    event.altKey !== shortcut.alt ||
    event.shiftKey !== shortcut.shift ||
    event.ctrlKey !== shortcut.ctrl ||
    event.metaKey !== shortcut.meta
  ) {
    return false;
  }
  const key = shortcut.key;
  if (/^[A-Z]$/.test(key)) return event.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}`;
  const named: Record<string, string> = {
    COMMA: "Comma",
    PERIOD: "Period",
    SPACE: "Space",
    ",": "Comma",
    ".": "Period",
  };
  const code = named[key];
  if (code) return event.code === code;
  return event.key.toUpperCase() === key;
}
