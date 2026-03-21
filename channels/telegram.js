#!/usr/bin/env node
/**
 * Claude Code - Telegram Channel Plugin
 *
 * Sends Claude Code hook events as Telegram notifications.
 * Used by .claude/settings.json hooks.
 *
 * Usage:
 *   node channels/telegram.js <event> [message]
 *   node channels/telegram.js test
 *   echo '{"session_id":"abc","stop_hook_active":true}' | node channels/telegram.js stop
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const THREAD_ID = process.env.TELEGRAM_THREAD_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  process.stderr.write(
    "[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env\n"
  );
  process.exit(1);
}

/**
 * Send a message to Telegram via Bot API
 */
async function sendMessage(text, options = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
    ...options,
  };

  if (THREAD_ID) {
    payload.message_thread_id = parseInt(THREAD_ID, 10);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${err}`);
  }

  return response.json();
}

/**
 * Format Claude Code hook event into a Telegram message
 */
function formatEvent(event, data) {
  const timestamp = new Date().toLocaleTimeString();
  const icons = {
    stop: "✅",
    error: "❌",
    start: "🚀",
    tool: "🔧",
    test: "🔔",
  };
  const icon = icons[event] || "📢";

  switch (event) {
    case "stop": {
      const sessionId = data.session_id
        ? `<code>${data.session_id.slice(0, 8)}</code>`
        : "N/A";
      return (
        `${icon} <b>Claude Code - Task Completed</b>\n` +
        `🕐 ${timestamp}\n` +
        `📋 Session: ${sessionId}`
      );
    }
    case "error": {
      return (
        `${icon} <b>Claude Code - Error</b>\n` +
        `🕐 ${timestamp}\n` +
        `💬 ${data.message || "An error occurred"}`
      );
    }
    case "start": {
      return (
        `${icon} <b>Claude Code - Session Started</b>\n` +
        `🕐 ${timestamp}`
      );
    }
    case "tool": {
      const tool = data.tool_name || "unknown";
      return (
        `${icon} <b>Tool Used:</b> <code>${tool}</code>\n` +
        `🕐 ${timestamp}`
      );
    }
    case "test": {
      return `${icon} <b>Telegram channel connected!</b>\nClaude Code notifications are working.\n🕐 ${timestamp}`;
    }
    default: {
      const msg = data.message || JSON.stringify(data);
      return `${icon} <b>Claude Code</b>\n🕐 ${timestamp}\n${msg}`;
    }
  }
}

async function main() {
  const event = process.argv[2] || "notify";

  // Test connection
  if (event === "test") {
    const msg = formatEvent("test", {});
    await sendMessage(msg);
    console.log("[telegram] Test message sent successfully.");
    return;
  }

  // Read JSON from stdin (Claude Code hook format)
  let data = {};
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw };
      }
    }
  }

  const text = formatEvent(event, data);
  await sendMessage(text);
  process.stderr.write(`[telegram] Notification sent for event: ${event}\n`);
}

main().catch((err) => {
  process.stderr.write(`[telegram] Failed to send notification: ${err.message}\n`);
  // Don't exit with error - hooks should not block Claude
  process.exit(0);
});
