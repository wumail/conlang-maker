export type UnicodeBlockId =
  | "basicLatin"
  | "latin1"
  | "latinExtA"
  | "latinExtB"
  | "ipa"
  | "combining"
  | "generalPunct"
  | "pua"
  | "other";

const RANGES: { id: UnicodeBlockId; start: number; end: number }[] = [
  { id: "basicLatin", start: 0x0000, end: 0x007f },
  { id: "latin1", start: 0x0080, end: 0x00ff },
  { id: "latinExtA", start: 0x0100, end: 0x017f },
  { id: "latinExtB", start: 0x0180, end: 0x024f },
  { id: "ipa", start: 0x0250, end: 0x02af },
  { id: "combining", start: 0x0300, end: 0x036f },
  { id: "generalPunct", start: 0x2000, end: 0x206f },
  { id: "pua", start: 0xe000, end: 0xf8ff },
  { id: "pua", start: 0xf0000, end: 0xffffd },
  { id: "pua", start: 0x100000, end: 0x10fffd },
];

export function unicodeBlockId(codepoint: number): UnicodeBlockId {
  return (
    RANGES.find((range) => codepoint >= range.start && codepoint <= range.end)
      ?.id ?? "other"
  );
}

/** Unicode combining marks. Private-use modifiers are not included. */
export function isCombiningMark(codepoint: number): boolean {
  return (
    (codepoint >= 0x0300 && codepoint <= 0x036f) ||
    (codepoint >= 0x1ab0 && codepoint <= 0x1aff) ||
    (codepoint >= 0x1dc0 && codepoint <= 0x1dff) ||
    (codepoint >= 0x20d0 && codepoint <= 0x20ff) ||
    (codepoint >= 0xfe20 && codepoint <= 0xfe2f)
  );
}

export function formatCodepoint(codepoint: number): string {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function charactersOf(text: string): string[] {
  return Array.from(text);
}
