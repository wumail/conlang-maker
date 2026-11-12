# Connecting `conlang-mcp` from a CLI agent (`T2.11` / HTTP transport)

This guide covers both ways of connecting an MCP client to Conlang Maker:

1. **Streamable HTTP** (default since the HTTP transport change) — the desktop app hosts the server on `http://127.0.0.1:43117/mcp` and each agent authenticates with an access token.
2. **stdio** (fallback) — the client launches `conlang-mcp` itself; unchanged from earlier releases.

> **Status of the DSH-specific instructions**: DSH's HTTP MCP configuration syntax has not been verified against its documentation, so this file does not prescribe a `dsh mcp add ...` command. Use the generic HTTP or stdio forms below; they work with any client that implements the MCP specification.

## 1. HTTP endpoint (recommended)

Start Conlang Maker. The sidecar starts automatically; verify it:

```bash
curl http://127.0.0.1:43117/healthz
# {"ok":true,"name":"conlang-maker-mcp","version":"1.0.7","pid":...,"port":43117,...}
```

Create an access token in **MCP Settings → Access Tokens**, then configure your client with:

| Item | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `http://127.0.0.1:43117/mcp` |
| Header | `Authorization: Bearer <token>` |
| Accept | `application/json, text/event-stream` |

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "conlang-maker": {
      "url": "http://127.0.0.1:43117/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http conlang-maker http://127.0.0.1:43117/mcp \
  --header "Authorization: Bearer <token>"
```

Notes:

- The server only binds `127.0.0.1`; requests with a non-loopback `Host` (or a non-loopback `Origin`) are rejected with 403.
- Tokens carry their own permission mode, toolsets, and default family. Changing them invalidates existing sessions (the client sees 404 and re-initializes).
- Deleting or disabling a token makes its next request fail with 401.
- The server stops when the GUI quits; if the GUI crashes, the `--parent-pid` watchdog stops it within a few seconds.

## 2. stdio fallback

From the repository root, verify the server starts cleanly over stdio:

```bash
bun mcp/main.ts --mode read-only --toolsets core,audit,compute
```

Client entry for a source checkout:

```json
{
  "mcpServers": {
    "conlang-maker": {
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

Packaged build (copy the exact path from **MCP Settings → stdio fallback**):

```json
{
  "mcpServers": {
    "conlang-maker": {
      "command": "/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp",
      "args": ["--mode", "read-only", "--toolsets", "core,audit,compute"]
    }
  }
}
```

## 3. Useful optional flags (stdio)

- `--family <family_id | path | name>`: pin a default language family when several exist in `registry.json`.
- `--registry <path>`: point to a custom `registry.json` (used by automated acceptance tests so host user settings are untouched).
- `--allow-root <dir>`: restrict file access to specific workspace parent directories.

In `serve` mode `--registry` / `--allow-root` form the baseline for every session, while `--port`, `--settings` and `--parent-pid` control the process itself. Exit codes: `0` clean, `3` already running, `4` port taken by another program, `1` other errors.

## 4. Recommended verification prompts

1. **List registered families & inspect genealogy**:
   > "Call `family_list` and `family_get_tree` to show all languages, word counts, and font inheritance."
2. **Audit whole-family OpenType font coverage**:
   > "Run `font_audit_family` on the active family and summarize missing `cmap` characters, unsubstituted multi-character romanization sequences, and any residual placeholder glyphs."
3. **Inspect romanization & trace IPA**:
   > "Run `romanization_analyze` on the proto-language and trace IPA conversion for sample words with `phono_to_ipa` (`trace: true`)."
