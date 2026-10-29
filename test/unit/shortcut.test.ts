import { describe, expect, it } from "vitest";
import { matchesShortcut, parseShortcut } from "../../src/shared/shortcut";

const key = (
  code: string,
  mods: Partial<{ alt: boolean; shift: boolean; ctrl: boolean; meta: boolean }>,
  k = "",
) => ({
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  code,
  key: k,
});

describe("parseShortcut", () => {
  it("parses macOS symbol notation", () => {
    expect(parseShortcut("⌥⇧G")).toEqual({ alt: true, shift: true, ctrl: false, meta: false, key: "G" });
    expect(parseShortcut("⌘⇧1")).toEqual({ alt: false, shift: true, ctrl: false, meta: true, key: "1" });
  });
  it("parses plus notation", () => {
    expect(parseShortcut("Alt+Shift+T")).toEqual({
      alt: true,
      shift: true,
      ctrl: false,
      meta: false,
      key: "T",
    });
    expect(parseShortcut("Ctrl+Shift+Comma")?.key).toBe("COMMA");
  });
  it("rejects empty or modifier-less shortcuts", () => {
    expect(parseShortcut("")).toBeUndefined();
    expect(parseShortcut(undefined)).toBeUndefined();
    expect(parseShortcut("Shift+T")).toBeUndefined();
  });
});

describe("matchesShortcut", () => {
  const shortcut = parseShortcut("⌥⇧G");
  it("matches by physical key even when Option changes the character", () => {
    expect(matchesShortcut(key("KeyG", { alt: true, shift: true }, "˝"), shortcut)).toBe(true);
  });
  it("requires the exact modifiers", () => {
    expect(matchesShortcut(key("KeyG", { alt: true }), shortcut)).toBe(false);
    expect(matchesShortcut(key("KeyG", { alt: true, shift: true, meta: true }), shortcut)).toBe(false);
    expect(matchesShortcut(key("KeyT", { alt: true, shift: true }), shortcut)).toBe(false);
  });
});
