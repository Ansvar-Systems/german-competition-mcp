#!/usr/bin/env node

/**
 * German Competition MCP — stdio entry point.
 *
 * Provides MCP tools for querying Bundeskartellamt decisions, merger control
 * cases, and sector enforcement activity under German competition law (GWB).
 *
 * Tool prefix: de_comp_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  searchDecisions,
  getDecision,
  searchMergers,
  getMerger,
  listSectors,
  getDataFreshness,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "german-competition-mcp";

// --- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: "de_comp_search_decisions",
    description:
      "Full-text search across Bundeskartellamt enforcement decisions (abuse of dominance, cartel, sector inquiries). Returns matching decisions with case number, parties, outcome, fine amount, and GWB articles cited.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'Marktmissbrauch', 'Facebook Nutzerdaten', 'Preisabsprache')",
        },
        type: {
          type: "string",
          enum: ["abuse_of_dominance", "cartel", "merger", "sector_inquiry"],
          description: "Filter by decision type. Optional.",
        },
        sector: {
          type: "string",
          description: "Filter by sector ID (e.g., 'digital_economy', 'energy', 'food_retail'). Optional.",
        },
        outcome: {
          type: "string",
          enum: ["prohibited", "cleared", "cleared_with_conditions", "fine"],
          description: "Filter by outcome. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "de_comp_get_decision",
    description:
      "Get a specific Bundeskartellamt decision by case number (e.g., 'B6-22/16', 'B2-94/12').",
    inputSchema: {
      type: "object" as const,
      properties: {
        case_number: {
          type: "string",
          description: "Bundeskartellamt case number (e.g., 'B6-22/16', 'B2-94/12')",
        },
      },
      required: ["case_number"],
    },
  },
  {
    name: "de_comp_search_mergers",
    description:
      "Search Bundeskartellamt merger control decisions (Fusionskontrolle). Returns merger cases with acquiring party, target, sector, and outcome.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'Vonovia Deutsche Wohnen', 'Energieversorgung', 'Lebensmitteleinzelhandel')",
        },
        sector: {
          type: "string",
          description: "Filter by sector ID (e.g., 'energy', 'food_retail', 'real_estate'). Optional.",
        },
        outcome: {
          type: "string",
          enum: ["cleared", "cleared_phase1", "cleared_with_conditions", "prohibited"],
          description: "Filter by merger outcome. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "de_comp_get_merger",
    description:
      "Get a specific merger control decision by case number (e.g., 'B1-35/21', 'B8-101/18').",
    inputSchema: {
      type: "object" as const,
      properties: {
        case_number: {
          type: "string",
          description: "Bundeskartellamt merger case number (e.g., 'B1-35/21', 'B8-101/18')",
        },
      },
      required: ["case_number"],
    },
  },
  {
    name: "de_comp_list_sectors",
    description:
      "List all sectors with Bundeskartellamt enforcement activity, including decision counts and merger counts per sector.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "de_comp_about",
    description:
      "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "de_comp_list_sources",
    description:
      "List the primary data sources used by this MCP server, including authority name, official URL, and coverage notes.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "de_comp_check_data_freshness",
    description:
      "Check the freshness of the underlying data: returns the latest decision/merger dates, record counts per table, and the timestamp of this check.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas for argument validation --------------------------------------

const SearchDecisionsArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["abuse_of_dominance", "cartel", "merger", "sector_inquiry"]).optional(),
  sector: z.string().optional(),
  outcome: z.enum(["prohibited", "cleared", "cleared_with_conditions", "fine"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetDecisionArgs = z.object({
  case_number: z.string().min(1),
});

const SearchMergersArgs = z.object({
  query: z.string().min(1),
  sector: z.string().optional(),
  outcome: z.enum(["cleared", "cleared_phase1", "cleared_with_conditions", "prohibited"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetMergerArgs = z.object({
  case_number: z.string().min(1),
});

// --- Shared _meta block -------------------------------------------------------

const META = {
  disclaimer:
    "This data is sourced from publicly available Bundeskartellamt publications. It is provided for informational purposes only and does not constitute legal advice. Coverage may be incomplete.",
  copyright:
    "© Bundeskartellamt. Data reproduced for research and informational purposes.",
  source_url: "https://www.bundeskartellamt.de/",
  data_note:
    "Covers enforcement decisions (abuse of dominance, cartel, sector inquiries) and merger control (Phase I/II). Excludes Landeskartellbehörden, court appeals, and EU Commission decisions.",
};

// --- Helper ------------------------------------------------------------------

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// --- Server setup ------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "de_comp_search_decisions": {
        const parsed = SearchDecisionsArgs.parse(args);
        const results = searchDecisions({
          query: parsed.query,
          type: parsed.type,
          sector: parsed.sector,
          outcome: parsed.outcome,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length, _meta: META });
      }

      case "de_comp_get_decision": {
        const parsed = GetDecisionArgs.parse(args);
        const decision = getDecision(parsed.case_number);
        if (!decision) {
          return errorContent(`Decision not found: ${parsed.case_number}`);
        }
        const decisionRecord = decision as Record<string, unknown>;
        return textContent({
          ...decisionRecord,
          _citation: buildCitation(
            String(decisionRecord.case_number ?? parsed.case_number),
            String(decisionRecord.title ?? decisionRecord.case_number ?? parsed.case_number),
            "de_comp_get_decision",
            { case_number: parsed.case_number },
            decisionRecord.url as string | undefined,
          ),
          _meta: META,
        });
      }

      case "de_comp_search_mergers": {
        const parsed = SearchMergersArgs.parse(args);
        const results = searchMergers({
          query: parsed.query,
          sector: parsed.sector,
          outcome: parsed.outcome,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length, _meta: META });
      }

      case "de_comp_get_merger": {
        const parsed = GetMergerArgs.parse(args);
        const merger = getMerger(parsed.case_number);
        if (!merger) {
          return errorContent(`Merger case not found: ${parsed.case_number}`);
        }
        const mergerRecord = merger as Record<string, unknown>;
        return textContent({
          ...mergerRecord,
          _citation: buildCitation(
            String(mergerRecord.case_number ?? parsed.case_number),
            String(mergerRecord.title ?? mergerRecord.case_number ?? parsed.case_number),
            "de_comp_get_merger",
            { case_number: parsed.case_number },
            mergerRecord.url as string | undefined,
          ),
          _meta: META,
        });
      }

      case "de_comp_list_sectors": {
        const sectors = listSectors();
        return textContent({ sectors, count: sectors.length, _meta: META });
      }

      case "de_comp_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Bundeskartellamt (German Federal Cartel Office) MCP server. Provides access to German competition law enforcement decisions, merger control cases, and sector enforcement data under the GWB (Gesetz gegen Wettbewerbsbeschränkungen).",
          data_source: "Bundeskartellamt (https://www.bundeskartellamt.de/)",
          coverage: {
            decisions: "Abuse of dominance (Marktmissbrauch), cartel enforcement, and sector inquiries",
            mergers: "Merger control decisions (Fusionskontrolle) — Phase I and Phase II",
            sectors: "Digital economy, energy, food retail, automotive, financial services, healthcare, media, telecommunications",
          },
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
          _meta: META,
        });
      }

      case "de_comp_list_sources": {
        return textContent({
          sources: [
            {
              authority: "Bundeskartellamt",
              authority_en: "German Federal Cartel Office",
              url: "https://www.bundeskartellamt.de/",
              decisions_url: "https://www.bundeskartellamt.de/EN/Decisions/decisions_node.html",
              mergers_url: "https://www.bundeskartellamt.de/EN/MergerControl/mergercontrol_node.html",
              coverage: "Enforcement decisions (abuse of dominance, cartel, sector inquiries) and merger control (Phase I/II)",
              jurisdiction: "Germany (federal)",
              language: "de",
              exclusions: [
                "Landeskartellbehörden (state-level cartel authorities)",
                "Court appeals (Beschwerdeverfahren)",
                "EU Commission decisions",
              ],
            },
          ],
          _meta: META,
        });
      }

      case "de_comp_check_data_freshness": {
        const freshness = getDataFreshness();
        return textContent({ ...freshness, _meta: META });
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`);
  }
});

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
