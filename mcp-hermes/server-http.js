#!/usr/bin/env node
/**
 * Hermes MCP Server (HTTP/SSE mode) — à déployer sur ton VPS Hostinger
 * Permet une connexion MCP distante via HTTPS.
 *
 * Usage: node server-http.js
 * Port: 3001 (configurable via PORT env var)
 */
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const HERMES_BASE_URL = process.env.HERMES_BASE_URL || "https://YOUR-VPS-DOMAIN.com";
const HERMES_API_KEY  = process.env.HERMES_API_KEY  || "";
const HERMES_MODEL    = process.env.HERMES_MODEL    || "hermes";
const PORT            = parseInt(process.env.PORT   || "3001", 10);
const MCP_SECRET      = process.env.MCP_SECRET      || "";

const app = express();
app.use(cors());
app.use(express.json());

// Optional: protect the endpoint with a shared secret
function checkSecret(req, res) {
  if (!MCP_SECRET) return true;
  const provided = req.headers["x-mcp-secret"] || req.query.secret;
  if (provided !== MCP_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function buildMcpServer() {
  const server = new McpServer({ name: "hermes-agent", version: "1.0.0" });

  server.tool(
    "chat_hermes",
    "Send a message to the Hermes agent and get a response.",
    {
      message: z.string().describe("The message to send to Hermes"),
      system_prompt: z.string().optional().describe("Optional system prompt"),
      temperature: z.number().min(0).max(2).optional(),
    },
    async ({ message, system_prompt, temperature }) => {
      const messages = [];
      if (system_prompt) messages.push({ role: "system", content: system_prompt });
      messages.push({ role: "user", content: message });

      const headers = { "Content-Type": "application/json" };
      if (HERMES_API_KEY) headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;

      const response = await fetch(`${HERMES_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: HERMES_MODEL, messages, temperature: temperature ?? 0.7 }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { content: [{ type: "text", text: `Hermes error ${response.status}: ${err}` }], isError: true };
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content ?? "(no response)";
      return { content: [{ type: "text", text: reply }] };
    }
  );

  server.tool(
    "list_hermes_models",
    "List available models on the Hermes endpoint.",
    {},
    async () => {
      const headers = { "Content-Type": "application/json" };
      if (HERMES_API_KEY) headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;

      const response = await fetch(`${HERMES_BASE_URL}/v1/models`, { method: "GET", headers });
      if (!response.ok) {
        const err = await response.text();
        return { content: [{ type: "text", text: `Error ${response.status}: ${err}` }], isError: true };
      }

      const data = await response.json();
      const models = data.data?.map((m) => m.id).join("\n") ?? "(none)";
      return { content: [{ type: "text", text: `Available models:\n${models}` }] };
    }
  );

  return server;
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "hermes-mcp", version: "1.0.0" });
});

// SSE endpoint — MCP client connects here
app.get("/sse", (req, res) => {
  if (!checkSecret(req, res)) return;

  const server = buildMcpServer();
  const transport = new SSEServerTransport("/message", res);
  server.connect(transport);
});

// Message endpoint — MCP client posts messages here
app.post("/message", (req, res) => {
  if (!checkSecret(req, res)) return;
  // SSEServerTransport handles this internally; this route is a placeholder
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Hermes MCP HTTP/SSE server listening on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`SSE:    http://localhost:${PORT}/sse`);
});
