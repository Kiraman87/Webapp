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
    if (system_prompt) {
      messages.push({ role: "system", content: system_prompt });
    }
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
