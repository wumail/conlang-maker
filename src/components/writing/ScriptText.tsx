import { useFontStore } from "../../store/fontStore";
import { usePhonoStore } from "../../store/phonoStore";
import { textToFontInput } from "../../core/engines/fontInput";

interface ScriptProps {
  text: string;
  className?: string;
  entryId?: string;
  ipa?: string;
}

function useFontInput({ text, entryId, ipa }: ScriptProps): string {
  const config = usePhonoStore((state) => state.config);
  const index = useFontStore((state) => state.inputIndex);
  return textToFontInput(text, config, index, entryId, ipa);
}

/** Romanized text rendered directly in the active language font when loaded. */
export function ScriptText(props: ScriptProps) {
  const input = useFontInput(props);
  return <span className={`conlang-script ${props.className ?? ""}`}>{input}</span>;
}

/** Native script line under a romanized headword. Hidden when no language font is loaded. */
export function ScriptLine(props: ScriptProps) {
  const loaded = useFontStore((state) => state.loaded);
  const input = useFontInput(props);
  if (!loaded || !props.text.trim()) return null;
  return <span className={`conlang-script ${props.className ?? ""}`}>{input}</span>;
}

/** Multi-line or display native script preview driven directly by the language font's OpenType shaping. */
export function ScriptPreview(props: ScriptProps) {
  const loaded = useFontStore((state) => state.loaded);
  const input = useFontInput(props);
  if (!loaded || !props.text.trim()) return null;
  return (
    <div
      className={`conlang-script whitespace-pre-wrap overflow-x-auto leading-relaxed ${props.className ?? ""}`}
      data-testid="script-preview"
    >
      {input}
    </div>
  );
}
