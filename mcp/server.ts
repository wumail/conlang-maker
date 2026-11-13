import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpConfig } from "./config";
import { registerAllPrompts } from "./prompts/index";
import { registerConlangResources } from "./resources/index";
import { registerAuditTools } from "./tools/audit";
import { registerCognateTools } from "./tools/cognates";
import { registerConceptTools } from "./tools/concepts";
import { registerCorpusTools } from "./tools/corpus";
import { registerExportImportTools } from "./tools/export_import";
import { registerFontsWritingTools } from "./tools/fonts_writing";
import { registerGrammarSandboxTools } from "./tools/grammar_sandbox";
import { registerLexiconTools } from "./tools/lexicon";
import { registerPhonologyTools } from "./tools/phonology";
import { registerScaTools } from "./tools/sca";
import { registerSnapshotTools } from "./tools/snapshots";
import { registerSystemFamilyTools } from "./tools/system_family";
import { registerWordgenTools } from "./tools/wordgen";

export function createServer(config: McpConfig): McpServer {
  const server = new McpServer(
    {
      name: "conlang-maker-mcp",
      version: config.version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // Register all 76 tools across 11 modules (filtered by config.toolsets in registerDefinedTool;
  // write/destructive mode checks are enforced inside tool handlers with structured error codes).
  registerSystemFamilyTools(server, config);
  registerPhonologyTools(server, config);
  registerFontsWritingTools(server, config);
  registerAuditTools(server, config);
  registerLexiconTools(server, config);
  registerWordgenTools(server, config);
  registerGrammarSandboxTools(server, config);
  registerScaTools(server, config);
  registerCorpusTools(server, config);
  registerConceptTools(server, config);
  registerCognateTools(server, config);
  registerExportImportTools(server, config);
  registerSnapshotTools(server, config);

  // Register 10 conlang:// resources and 4 guided workflow prompts
  registerConlangResources(server, config);
  registerAllPrompts(server, config);

  return server;
}
