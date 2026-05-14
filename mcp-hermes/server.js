#!/usr/bin/env node
/**
 * Hermes MCP Server (stdio mode) — for Claude Desktop / Claude Code CLI
 * Configure HERMES_BASE_URL and HERMES_API_KEY via environment variables.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HERMES_BASE_URL = process.env.HERMES_BASE_URL || "https://YOUR-VPS-DOMAIN.com";
const HERMES_API_KEY  = process.env.HERMES_API_KEY  || "";
const HERMES_MODEL    = process.env.HERMES_MODEL    || "hermes";

const HERMES_SYSTEM_PROMPT = process.env.HERMES_SYSTEM_PROMPT ||
`Tu es un agent IA nommé Hermes, connecté à Claude via le protocole MCP (Model Context Protocol).

Rôle :
- Tu reçois des requêtes de Claude via MCP et tu y réponds avec précision.
- Tu peux effectuer des tâches que Claude te délègue : analyse, génération de texte, raisonnement, code, etc.

Règles de communication MCP :
1. Réponds toujours en texte clair et structuré.
2. Si la requête est ambiguë, demande une clarification en une seule phrase.
3. Indique clairement si tu ne peux pas traiter une demande.
4. Ne répète pas la question, va directement à la réponse.
5. Si on te demande de confirmer la connexion, réponds exactement : "MCP_OK: Hermes connecté et opérationnel."

Tu es un outil de Claude, travaille en synergie avec lui.`;

const server = new McpServer({
  name: "hermes-agent",
  version: "1.0.0",
});

server.tool(
  "chat_hermes",
  "Send a message to the Hermes agent running on the VPS and get a response.",
  {
    message: z.string().describe("The message or question to send to Hermes"),
    system_prompt: z
      .string()
      .optional()
      .describe("Optional system prompt to guide Hermes behaviour"),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Sampling temperature (0-2, default 0.7)"),
  },
  async ({ message, system_prompt, temperature }) => {
    const messages = [];
    // Use caller-provided prompt, or fall back to the default MCP system prompt
    messages.push({ role: "system", content: system_prompt || HERMES_SYSTEM_PROMPT });
    messages.push({ role: "user", content: message });

    const headers = {
      "Content-Type": "application/json",
    };
    if (HERMES_API_KEY) {
      headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;
    }

    const response = await fetch(`${HERMES_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages,
        temperature: temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return {
        content: [
          {
            type: "text",
            text: `Hermes API error ${response.status}: ${err}`,
          },
        ],
        isError: true,
      };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content ?? "(no response)";

    return {
      content: [{ type: "text", text: reply }],
    };
  }
);

server.tool(
  "list_hermes_models",
  "List models available on the Hermes endpoint.",
  {},
  async () => {
    const headers = { "Content-Type": "application/json" };
    if (HERMES_API_KEY) {
      headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;
    }

    const response = await fetch(`${HERMES_BASE_URL}/v1/models`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const err = await response.text();
      return {
        content: [{ type: "text", text: `Error ${response.status}: ${err}` }],
        isError: true,
      };
    }

    const data = await response.json();
    const models = data.data?.map((m) => m.id).join("\n") ?? "(aucun)";

    return {
      content: [{ type: "text", text: `Modèles disponibles:\n${models}` }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
