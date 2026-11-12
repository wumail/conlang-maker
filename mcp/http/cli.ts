import { parseConfig, type McpConfig } from "../config";
import { normalizeToMcpError } from "../errors";
import {
  getDefaultSettingsPath,
  loadOrCreateSettings,
  type McpServerSettings,
} from "./settings";
import {
  EXIT_ALREADY_RUNNING,
  EXIT_PORT_IN_USE,
  PortInUseError,
  startHttpServer,
  type RunningHttpServer,
} from "./serve";

/**
 * `conlang-mcp serve` — long-running Streamable HTTP server owned by the GUI.
 *
 * Exit codes: 0 normal shutdown, 3 another conlang-mcp already serves the port,
 * 4 the port is taken by a different program, 1 anything else.
 */

export interface ServeArgs {
  /** `--port`; overrides the port stored in the settings file. */
  port?: number;
  settingsPath: string;
  /** `--parent-pid`; the server exits once this process disappears. */
  parentPid?: number;
  /** argv with the serve-only flags removed, handed to `parseConfig`. */
  configArgv: string[];
}

const SERVE_FLAGS = new Set(["--port", "--settings", "--parent-pid"]);

function parsePositiveInt(flag: string, raw: string, max: number): number {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`Invalid value "${raw}" for ${flag}`);
  }
  return value;
}

/** Splits `serve` arguments into serve-only options and the shared config flags. */
export function parseServeArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ServeArgs {
  let port: number | undefined;
  let parentPid: number | undefined;
  let settingsPath = env.CONLANG_MCP_SETTINGS?.trim() || getDefaultSettingsPath(env);
  const configArgv: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eqIdx = arg.indexOf("=");
    const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx >= 0 ? arg.slice(eqIdx + 1) : undefined;
    const takeValue = (): string => {
      if (inlineVal !== undefined) return inlineVal;
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for flag ${flag}`);
      return next;
    };

    if (!SERVE_FLAGS.has(flag)) {
      configArgv.push(arg);
      continue;
    }
    switch (flag) {
      case "--port": {
        const raw = takeValue().trim();
        // 0 is allowed so an OS-assigned port can be used (tests, diagnostics).
        if (raw === "0") {
          port = 0;
          break;
        }
        port = parsePositiveInt(flag, raw, 65535);
        if (port === 0) throw new Error(`Invalid value "${raw}" for ${flag}`);
        break;
      }
      case "--settings":
        settingsPath = takeValue().trim();
        break;
      case "--parent-pid":
        parentPid = parsePositiveInt(flag, takeValue(), 2 ** 31 - 1);
        break;
    }
  }

  if (!settingsPath) throw new Error("--settings must not be empty");
  return { port, settingsPath, parentPid, configArgv };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function runServeCommand(argv: string[]): Promise<number> {
  let args: ServeArgs;
  let baseConfig: McpConfig;
  let settings: McpServerSettings;
  let created = false;

  try {
    args = parseServeArgs(argv);
    baseConfig = parseConfig(args.configArgv);
    const loaded = loadOrCreateSettings(args.settingsPath);
    settings = loaded.settings;
    created = loaded.created;
  } catch (err) {
    const mcpErr = normalizeToMcpError(err);
    console.error(`[conlang-mcp] Fatal startup error [${mcpErr.code}]: ${mcpErr.message}`);
    return 1;
  }

  if (created) {
    // Never print the token itself: it lives in the 0600 settings file.
    console.error(
      `[conlang-mcp] created settings file ${args.settingsPath} with one read-only "Default" token; ` +
        `copy it from that file or from the GUI settings page.`,
    );
  }

  let server: RunningHttpServer;
  try {
    server = await startHttpServer({
      baseConfig,
      settingsPath: args.settingsPath,
      initialSettings: settings,
      port: args.port ?? settings.port,
    });
  } catch (err) {
    if (err instanceof PortInUseError) {
      if (err.existing) {
        console.error(
          `[conlang-mcp] already serving 127.0.0.1:${err.port} (version ${err.existing.version ?? "?"}, pid ${err.existing.pid ?? "?"})`,
        );
        return EXIT_ALREADY_RUNNING;
      }
      console.error(`[conlang-mcp] 127.0.0.1:${err.port} is already in use by another program`);
      return EXIT_PORT_IN_USE;
    }
    const mcpErr = normalizeToMcpError(err);
    console.error(`[conlang-mcp] Fatal startup error [${mcpErr.code}]: ${mcpErr.message}`);
    return 1;
  }

  console.error(`[conlang-mcp] v${baseConfig.version} serving ${server.url}`);

  return await new Promise<number>((resolve) => {
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let shuttingDown = false;

    const shutdown = async (code: number): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (watchdog) clearInterval(watchdog);
      try {
        await server.stop();
      } catch (err) {
        console.error(`[conlang-mcp] Error while stopping: ${(err as Error).message}`);
      }
      resolve(code);
    };

    process.on("SIGINT", () => void shutdown(0));
    process.on("SIGTERM", () => void shutdown(0));
    if (process.platform === "win32") {
      process.on("SIGBREAK", () => void shutdown(0));
    }

    if (args.parentPid && args.parentPid > 0) {
      const parentPid = args.parentPid;
      watchdog = setInterval(() => {
        if (!isProcessAlive(parentPid)) {
          console.error(`[conlang-mcp] parent process ${parentPid} is gone; shutting down`);
          void shutdown(0);
        }
      }, 2000);
    }
  });
}
