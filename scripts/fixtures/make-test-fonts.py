#!/usr/bin/env python3
"""Generate deterministic OpenType test fonts for Conlang Maker MCP tests.

Outputs:
  - tests/fixtures/fonts/liga-test.ttf     (post v2.0 with glyph names)
  - tests/fixtures/fonts/no-names-test.ttf (post v3.0 without glyph names)
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

FIXED_TIMESTAMP = 3800000000  # Deterministic Mac epoch timestamp

GLYPH_ORDER = [
    ".notdef",
    "space",
    "a",
    "c",
    "h",
    "c_h",
    "roman.x",
]

CMAP = {
    0x20: "space",
    0x61: "a",
    0x63: "c",
    0x68: "h",
    0x78: "roman.x",
}

FEA_SOURCE = """\
languagesystem DFLT dflt;
languagesystem latn dflt;

feature liga {
    sub c h by c_h;
} liga;
"""


def _rect_glyph(x0: int, y0: int, x1: int, y1: int):
    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()
    return pen.glyph()


def _empty_glyph():
    pen = TTGlyphPen(None)
    return pen.glyph()


def build_font(
    output_path: Path,
    *,
    family_name: str,
    ps_name: str,
    keep_glyph_names: bool,
) -> str:
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(list(GLYPH_ORDER))
    fb.setupCharacterMap(dict(CMAP))

    glyphs = {
        ".notdef": _rect_glyph(50, 0, 450, 700),
        "space": _empty_glyph(),
        "a": _rect_glyph(60, 0, 440, 500),
        "c": _rect_glyph(70, 0, 430, 500),
        "h": _rect_glyph(60, 0, 440, 720),
        "c_h": _rect_glyph(60, 0, 740, 720),
        "roman.x": _rect_glyph(80, 0, 420, 500),
    }
    fb.setupGlyf(glyphs)

    metrics = {
        ".notdef": (500, 50),
        "space": (250, 0),
        "a": (500, 60),
        "c": (500, 70),
        "h": (500, 60),
        "c_h": (800, 60),
        "roman.x": (500, 80),
    }
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)

    fb.setupNameTable(
        {
            "familyName": family_name,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"{family_name} Regular 1.0",
            "fullName": f"{family_name} Regular",
            "version": "Version 1.0",
            "psName": ps_name,
        }
    )
    fb.setupOS2(
        sTypoAscender=800,
        sTypoDescender=-200,
        sTypoLineGap=0,
        usWinAscent=800,
        usWinDescent=200,
        sxHeight=500,
        sCapHeight=700,
    )
    fb.setupPost(keepGlyphNames=keep_glyph_names)

    addOpenTypeFeaturesFromString(fb.font, FEA_SOURCE)

    fb.font["head"].created = FIXED_TIMESTAMP
    fb.font["head"].modified = FIXED_TIMESTAMP
    fb.font["head"].fontRevision = 1.0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(output_path))

    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    return digest


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    fonts_dir = repo_root / "tests" / "fixtures" / "fonts"

    liga_path = fonts_dir / "liga-test.ttf"
    no_names_path = fonts_dir / "no-names-test.ttf"

    liga_sha = build_font(
        liga_path,
        family_name="Conlang Liga Test",
        ps_name="ConlangLigaTest-Regular",
        keep_glyph_names=True,
    )
    no_names_sha = build_font(
        no_names_path,
        family_name="Conlang NoNames Test",
        ps_name="ConlangNoNamesTest-Regular",
        keep_glyph_names=False,
    )

    print(f"{liga_sha}  {liga_path.relative_to(repo_root)}")
    print(f"{no_names_sha}  {no_names_path.relative_to(repo_root)}")


if __name__ == "__main__":
    main()
