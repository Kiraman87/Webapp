#!/usr/bin/env node
/**
 * Test simple pour vérifier que l'API Hermes répond correctement
 * Usage: node test-connection.js
 */

const HERMES_BASE_URL = process.env.HERMES_BASE_URL || "https://YOUR-VPS-DOMAIN.com";
const HERMES_API_KEY  = process.env.HERMES_API_KEY  || "";
const HERMES_MODEL    = process.env.HERMES_MODEL    || "hermes";

async function testConnection() {
  console.log(`\nTest de connexion vers: ${HERMES_BASE_URL}\n`);

  // 1. Test /v1/models
  console.log("1. Liste des modèles disponibles...");
  try {
    const headers = { "Content-Type": "application/json" };
    if (HERMES_API_KEY) headers["Authorization"] = `Bearer ${HERMES_API_KEY}`;

    const res = await fetch(`${HERMES_BASE_URL}/v1/models`, { headers });
    if (res.ok) {
      const data = await res.json();
      const ids = data.data?.map((m) => `  - ${m.id}`).join("\n") || "  (aucun)";
      console.log(`   OK — modèles:\n${ids}`);
    } else {
      console.log(`   ERREUR ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.log(`   ERREUR réseau: ${e.message}`);
  }

  // 2. Test /v1/chat/completions
  console.log("\n2. Test d'une requête de chat...");
  try {
    const headers = {
      "Content-Type": "application/json",
      ...(HERMES_API_KEY ? { Authorization: `Bearer ${HERMES_API_KEY}` } : {}),
    };

    const res = await fetch(`${HERMES_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages: [{ role: "user", content: "Dis juste 'OK Hermes fonctionne!' et rien d'autre." }],
        max_tokens: 20,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content ?? "(réponse vide)";
      console.log(`   OK — Réponse Hermes: "${reply}"`);
    } else {
      console.log(`   ERREUR ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.log(`   ERREUR réseau: ${e.message}`);
  }

  console.log("\nTest terminé.\n");
}

testConnection();
