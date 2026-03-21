#!/usr/bin/env node
/**
 * Sets the Telegram webhook to point to your Cloudflare Worker URL.
 *
 * Usage:
 *   node worker/setup-webhook.js <your-worker-url>
 *
 * Example:
 *   node worker/setup-webhook.js https://claude-telegram-bot.<your-subdomain>.workers.dev
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WORKER_URL = process.argv[2];

if (!BOT_TOKEN) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

if (!WORKER_URL) {
  console.error("❌ Please provide your Worker URL as argument.");
  console.error("   node worker/setup-webhook.js https://claude-telegram-bot.xxx.workers.dev");
  process.exit(1);
}

async function main() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

  console.log(`Setting webhook to: ${WORKER_URL}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: WORKER_URL }),
  });

  const data = await res.json();

  if (data.ok) {
    console.log("✅ Webhook set successfully!");
    console.log("   You can now chat with your bot on Telegram.");
  } else {
    console.error("❌ Failed to set webhook:", data.description);
  }
}

main().catch(console.error);
