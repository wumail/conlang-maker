import { useFontStore } from "../../store/fontStore";

/** Romanized text rendered directly in the active language font when loaded. */
export function ScriptText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return <span className={`conlang-script ${className}`}>{text}</span>;
}

/** Native script line under a romanized headword. Hidden when no language font is loaded. */
export function ScriptLine({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const loaded = useFontStore((state) => state.loaded);
  if (!loaded || !text.trim()) return null;
  return <span className={`conlang-script ${className}`}>{text}</span>;
}

/** Multi-line or display native script preview driven directly by the language font's OpenType shaping. */
export function ScriptPreview({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const loaded = useFontStore((state) => state.loaded);
  if (!loaded || !text.trim()) return null;
  return (
    <div
      className={`conlang-script whitespace-pre-wrap overflow-x-auto leading-relaxed ${className}`}
      data-testid="script-preview"
    >
      {text}
    </div>
  );
}
