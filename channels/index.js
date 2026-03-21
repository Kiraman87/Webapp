#!/usr/bin/env node
/**
 * Claude Code Channels - Entry Point
 *
 * Available channels:
 *   - telegram: Send notifications via Telegram bot
 *
 * Usage:
 *   node channels/index.js telegram test
 *   node channels/index.js telegram stop
 */

const path = require("path");

const [, , channel, ...args] = process.argv;

const channels = {
  telegram: "./telegram.js",
};

if (!channel || !channels[channel]) {
  console.log("Claude Code Channels\n");
  console.log("Available channels:");
  Object.keys(channels).forEach((c) => console.log(`  - ${c}`));
  console.log("\nUsage: node channels/index.js <channel> <event>");
  process.exit(0);
}

// Forward to the selected channel plugin
process.argv = [process.argv[0], channels[channel], ...args];
require(path.join(__dirname, channels[channel]));
