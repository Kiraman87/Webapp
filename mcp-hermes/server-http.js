#!/usr/bin/env node
/**
 * Hermes MCP Server (HTTP/SSE mode) — déployer sur VPS Hostinger
 * Expose un endpoint SSE MCP que Claude Desktop peut consommer.
 *
 * Usage: node server-http.js
 * Config: fichier .env dans le même dossier
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Chargement du .env si présent (sans dépendance externe)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => {
      const [key, ...rest] = l.split("=");
      if (key && !process.env[key.trim()]) {
        process.env[key.trim()] = rest.join("=").trim();
      }
    });
}

import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const HERMES_BASE_URL = process.env.HERMES_BASE_URL;
const HERMES_API_KEY  = process.env.HERMES_API_KEY  || "";
const HERMES_MODEL    = process.env.HERMES_MODEL    || "hermes";
const PORT            = parseInt(process.env.PORT   || "3001", 10);
const MCP_SECRET      = process.env.MCP_SECRET      || "";

if (!HERMES_BASE_URL) {
  console.error("ERREUR: HERMES_BASE_URL non défini. Vérifie ton fichier .env");
  process.exit(1);
}

const SYSTEM_PROMPT =
`Tu es un agent IA nommé Hermes, connecté à Claude via MCP.
Tu reçois des requêtes de Claude et tu y réponds avec précision.
Règles : texte clair, réponse directe sans répéter la question.
Si on te demande de confirmer la connexion, réponds : "MCP_OK: Hermes connecté et opérationnel."`;

const app = express();
app.use(cors());
app.use(express.json());

function auth(req, res) {
  if (!MCP_SECRET) return true;
  const secret = req.headers["x-mcp-secret"] || req.query.secret;
  const bearer = (req.headers["authorization"] || "").replace("Bearer ", "");
  if (secret !== MCP_SECRET && bearer !== MCP_SECRET) {
    res.status(401).json({ error: "Non autorisé" });
    return false;
  }
  return true;
}

async function callHermes(messages, temperature = 0.7) {
  const headers = { "Content-Type": "application/json" };
  if (HERMES_API_KEY) headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;

  const res = await fetch(`${HERMES_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: HERMES_MODEL, messages, temperature }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hermes ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "(réponse vide)";
}

function buildServer() {
  const server = new McpServer({ name: "hermes-agent", version: "1.0.0" });

  server.tool(
    "chat_hermes",
    "Envoie un message à l'agent Hermes sur le VPS et retourne sa réponse.",
    {
      message: z.string().describe("Le message à envoyer à Hermes"),
      system_prompt: z.string().optional().describe("Prompt système personnalisé (optionnel)"),
      temperature: z.number().min(0).max(2).optional(),
    },
    async ({ message, system_prompt, temperature }) => {
      try {
        const reply = await callHermes(
          [
            { role: "system", content: system_prompt || SYSTEM_PROMPT },
            { role: "user",   content: message },
          ],
          temperature
        );
        return { content: [{ type: "text", text: reply }] };
      } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "list_hermes_models",
    "Liste les modèles disponibles sur l'endpoint Hermes.",
    {},
    async () => {
      try {
        const headers = { "Content-Type": "application/json" };
        if (HERMES_API_KEY) headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;
        const res = await fetch(`${HERMES_BASE_URL}/v1/models`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = data.data?.map((m) => `- ${m.id}`).join("\n") || "(aucun)";
        return { content: [{ type: "text", text: `Modèles disponibles:\n${list}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  return server;
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "hermes-mcp", model: HERMES_MODEL, endpoint: HERMES_BASE_URL });
});

// SSE — le client MCP (Claude Desktop) se connecte ici
const transports = {};

app.get("/sse", (req, res) => {
  if (!auth(req, res)) return;
  const server = buildServer();
  const transport = new SSEServerTransport("/message", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  server.connect(transport);
});

// Messages MCP entrants
app.post("/message", (req, res) => {
  if (!auth(req, res)) return;
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(404).json({ error: "Session inconnue" });
  transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Hermes MCP SSE server démarré`);
  console.log(`  Base URL Hermes : ${HERMES_BASE_URL}`);
  console.log(`  Port local      : ${PORT}`);
  console.log(`  Health check    : http://localhost:${PORT}/health`);
  console.log(`  SSE endpoint    : http://localhost:${PORT}/sse`);
  console.log(MCP_SECRET ? `  Auth            : MCP_SECRET actif` : `  Auth            : aucune`);
});
