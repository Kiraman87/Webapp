# Webapp - Claude Code Channels + Telegram Plugin

This project configures **Claude Code channels** with a **Telegram notification plugin**.

When Claude Code finishes a task or sends a notification, a message is automatically delivered to your Telegram chat.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Telegram credentials:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Your chat ID (get it from @userinfobot on Telegram) |
| `TELEGRAM_THREAD_ID` | *(Optional)* Topic thread ID for group topics |

### 3. Get a Telegram Bot Token

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the token and paste it into `.env`

### 4. Get your Chat ID

1. Open Telegram and search for **@userinfobot**
2. Send `/start` — it will reply with your chat ID
3. For groups: add the bot to the group, send a message, then check the chat ID

### 5. Test the connection

```bash
npm run telegram:test
```

You should receive a test message in Telegram.

---

## How it works

### Claude Code Hooks (`.claude/settings.json`)

The hooks configuration tells Claude Code to call the Telegram plugin on events:

- **Stop** — fires when Claude finishes a task
- **Notification** — fires when Claude sends a notification

### Telegram Plugin (`channels/telegram.js`)

- Reads the hook event data from stdin (JSON)
- Formats it into a readable Telegram message
- Sends it via the Telegram Bot API

### Manual usage

```bash
# Test connection
node channels/telegram.js test

# Send a stop notification
echo '{"session_id":"abc123"}' | node channels/telegram.js stop

# List available channels
node channels/index.js
```

---

## File structure

```
Webapp/
├── .claude/
│   └── settings.json       # Claude Code channels & hooks config
├── channels/
│   ├── index.js            # Channel router
│   └── telegram.js         # Telegram notification plugin
├── .env                    # Your credentials (git-ignored)
├── .env.example            # Template
└── package.json
```