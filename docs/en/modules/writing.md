# Writing System

Manage your language's native script font (OpenType `.ttf` / `.otf`), character reference annotations, and glyph geometry diagnostics.

**Navigate**: click `Writing` in the top navigation bar.

## Font Import & Family Inheritance

Conlang Maker uses a real font-driven rendering pipeline shared across the Lexicon, Paradigm Matrix, Translation Sandbox, Corpus, and Reference Grammar Book exports:

- **Own Font (`own`)**: Import a `.ttf` or `.otf` font (up to 20 MB; automatically validated for OpenType magic bytes, HarfBuzz loadability, and non-empty `cmap`).
- **Ancestor Inheritance (`inherited`)**: Daughter languages without their own font automatically inherit the nearest ancestor's font along `parent_id`. Clearing a local font seamlessly restores ancestor inheritance.
- **OpenType Stylistic Sets (`ss01`, etc.)**: When a font exposes stylistic features in `GSUB`, toggle switches appear automatically and persist in `font_features`.
- **Phoneme-Aware Font Input (`font_input`)**: Converts phoneme sequences into font-ready input while preserving phoneme boundaries (distinguishing diphthongs vs. hiatus vowels, or `/k h/` vs. `/x/`), with optional `use_parent_phonemes` for historical orthography on inherited words.

## Glyph Grid & Metric Rulers

Once a font is active, the Writing page displays its encoded character grid:

- **Metric Ruler Overlay**: Toggle Baseline, Cap Height, x-Height, Ascender, and Descender guides across glyph cells to spot vertical alignment issues at a glance.
- **Zoom Preview**: Click any glyph cell to inspect its enlarged outline, Unicode codepoint, advance width, and left/right side bearings.

## Character Reference Annotations

Attach linguistic metadata to encoded codepoints:

- **Fields**: Display label, character kind (consonant letter, vowel letter, diacritic mark, numeral, punctuation, etc.), and mapped IPA phonemes.
- **Parent Sync**: Child languages inherit parent annotations by default, localize individual items on edit, and support one-click sync for newly added parent annotations.

## Glyph Geometry & Shaping Diagnostics

Powered by HarfBuzz WebAssembly, the geometry inspector scans active fonts for common font-engineering defects:

- Outlier advance widths (unexpectedly narrow, wide, or zero-width spacing glyphs)
- Vertical metric overflows exceeding `ascender` / `descender` bounds
- Empty outlines and `.notdef` fallback hits
- Unsubstituted multi-character sequences (`liga` / `calt` / `ccmp`) and residual Latin placeholder glyphs (also available across the entire family via MCP `font_audit_coverage` and `font_audit_geometry`)
