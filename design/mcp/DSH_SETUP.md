# Connecting `conlang-mcp` in DSH (`T2.11`)

This guide explains how to connect Conlang Maker's MCP server (`conlang-mcp`) to **DSH** (or any stdio-compatible MCP client) in both local source development and packaged desktop release environments.

## 1. Local Development Mode (Bun Source Entry)

From the repository root, verify the server starts cleanly over stdio:

```bash
bun mcp/main.ts --mode read-only --toolsets core,audit,compute
```

Add the server entry to your DSH MCP configuration (`~/.config/dsh/config.json` or workspace profile):

```json
{
  "mcpServers": {
    "conlang": {
      "command": "bun",
      "args": [
        "/absolute/path/to/conlang-maker/mcp/main.ts",
        "--mode",
        "read-only",
        "--toolsets",
        "core,audit,compute"
      ]
    }
  }
}
```

To enable write workflows (lexicon editing, phonology updates, font imports, diachronic evolution), switch `--mode` and `--toolsets`:

```json
{
  "mcpServers": {
    "conlang": {
      "command": "bun",
      "args": [
        "/absolute/path/to/conlang-maker/mcp/main.ts",
        "--mode",
        "write",
        "--toolsets",
        "core,audit,compute,write,evolution"
      ]
    }
  }
}
```

## 2. Packaged Release Binary Mode

After building the sidecar binary (`node scripts/build-mcp.mjs`) or installing the Conlang Maker desktop app, you can copy the ready-made DSH snippet directly from Conlang Maker's **MCP Settings** page:

```json
{
  "mcpServers": {
    "conlang": {
      "command": "/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp",
      "args": [
        "--mode",
        "read-only",
        "--toolsets",
        "core,audit,compute"
      ]
    }
  }
}
```

## 3. Useful Optional Flags

- `--family <family_id | path | name>`: Pin a default language family when multiple families exist in `registry.json`.
- `--registry <path>`: Point to a custom `registry.json` (used in automated acceptance tests so host user settings are untouched).
- `--allow-root <dir>`: Restrict file access to specific workspace parent directories.

## 4. Recommended Verification Prompts in DSH

1. **List registered families & inspect genealogy**:
   > "Call `family_list` and `family_get_tree` to show all languages, word counts, and font inheritance."
2. **Audit whole-family OpenType font coverage**:
   > "Run `font_audit_family` on the active family and summarize missing `cmap` characters, unsubstituted multi-character romanization sequences, and any residual placeholder glyphs."
3. **Inspect romanization & trace IPA**:
   > "Run `romanization_analyze` on the proto-language and trace IPA conversion for sample words with `phono_to_ipa` (`trace: true`)."
