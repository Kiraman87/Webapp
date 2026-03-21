/**
 * Claude Telegram Bot — Cloudflare Worker
 *
 * Receives messages from Telegram, sends them to Claude API,
 * and replies back to the user in Telegram.
 *
 * Required environment secrets (set via wrangler secret put):
 *   TELEGRAM_BOT_TOKEN   — your Telegram bot token
 *   ANTHROPIC_API_KEY    — your Anthropic API key
 *   ALLOWED_CHAT_ID      — (optional) restrict to your chat ID only
 */

export default {
  async fetch(request, env) {
    // Only handle POST requests from Telegram
    if (request.method !== "POST") {
      return new Response("Claude Telegram Bot is running.", { status: 200 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const message = body?.message || body?.edited_message;
    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userId = String(message.from?.id);
    const text = message.text.trim();

    // Restrict to allowed chat ID if set
    if (env.ALLOWED_CHAT_ID && userId !== String(env.ALLOWED_CHAT_ID)) {
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, "⛔ Sorry, this is a private bot.");
      return new Response("OK", { status: 200 });
    }

    // Handle /start command
    if (text === "/start") {
      await sendTelegram(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        "👋 *Hello\\! I'm Claude*, your AI assistant\\.\n\nJust send me any message and I'll respond\\."
      );
      return new Response("OK", { status: 200 });
    }

    // Show typing indicator
    await sendChatAction(env.TELEGRAM_BOT_TOKEN, chatId);

    // Call Claude API
    let reply;
    try {
      reply = await callClaude(env.ANTHROPIC_API_KEY, text);
    } catch (err) {
      reply = `❌ Error calling Claude: ${err.message}`;
    }

    // Send Claude's response back to Telegram
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply);

    return new Response("OK", { status: 200 });
  },
};

/**
 * Call the Claude API and return the text response
 */
async function callClaude(apiKey, userMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "Sorry, I could not generate a response.";
}

/**
 * Send a message to Telegram
 */
async function sendTelegram(token, chatId, text) {
  // Telegram MarkdownV2 — fall back to plain text if message is too long
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 4096), // Telegram max message length
    parse_mode: "Markdown",
  };

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  // If markdown fails, retry as plain text
  if (!res.ok) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
    });
  }
}

/**
 * Show "typing..." indicator in Telegram
 */
async function sendChatAction(token, chatId) {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}
