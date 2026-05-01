'use strict';

/**
 * formatters.js — Telegram message formatting utilities
 * ═══════════════════════════════════════════════════════════════
 * All Telegram-facing text lives in helpers so:
 *   • Formatting is consistent across all commands.
 *   • Tests can assert on message content without coupling to handlers.
 *   • Future i18n or layout changes touch one file.
 *
 * Telegram MarkdownV2 special chars that must be escaped:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * We use Markdown (v1) here for simplicity since we control all text
 * and don't accept user-supplied content in these messages.
 * ═══════════════════════════════════════════════════════════════
 */

// ── Platform display names & emoji ────────────────────────────

const PLATFORM_META = {
  TWITTER:   { emoji: '🐦', label: 'Twitter / X'  },
  LINKEDIN:  { emoji: '💼', label: 'LinkedIn'      },
  INSTAGRAM: { emoji: '📸', label: 'Instagram'     },
  FACEBOOK:  { emoji: '📘', label: 'Facebook'      },
  THREADS:   { emoji: '🧵', label: 'Threads'       },
  MEDIUM:    { emoji: '✍️',  label: 'Medium'        },
  DEVTO:     { emoji: '👩‍💻', label: 'Dev.to'        },
};

function platformLabel(platform) {
  const meta = PLATFORM_META[platform];
  return meta ? `${meta.emoji} ${meta.label}` : `🔗 ${platform}`;
}

// ── /start ────────────────────────────────────────────────────

function startMessage(firstName) {
  return (
    `👋 Welcome${firstName ? `, *${escMd(firstName)}*` : ''}\\!\n\n` +
    `I'm your *AI Content Publishing* assistant\\.\n\n` +
    `Use /link to connect your account, then /help to see everything I can do\\.`
  );
}

// ── /help ─────────────────────────────────────────────────────

function helpMessage() {
  return (
    `📖 *Available Commands*\n\n` +

    `*Account*\n` +
    `  /start — Welcome message\n` +
    `  /link — Connect your account\n` +
    `  /help — Show this help\n\n` +

    `*Social Accounts*\n` +
    `  /accounts — View connected platforms\n\n` +

    `*Content*\n` +
    `  /create — Generate & publish content\n` +
    `  /post — Alias for /create\n` +
    `  /drafts — View saved drafts \_(coming soon)_\n` +
    `  /schedule — Schedule a post \_(coming soon)_\n\n` +

    `💡 *Tip:* Link your account first with /link\\.`
  );
}

// ── /accounts ─────────────────────────────────────────────────

/**
 * Render a list of connected social accounts.
 * @param {Array} accounts  Safe account objects (no tokens)
 * @param {string} userName App user's display name
 */
function accountsMessage(accounts, userName) {
  if (accounts.length === 0) {
    return (
      `📭 *No accounts connected*\n\n` +
      `You haven't linked any social platforms yet\\.\n` +
      `Add them via the web app at _Settings → Social Accounts_\\.`
    );
  }

  const header = `🔗 *Connected Accounts* for _${escMd(userName)}_\n\n`;

  const rows = accounts.map((acc, i) => {
    const label   = platformLabel(acc.platform);
    const handle  = escMd(acc.handle);
    const expiry  = acc.token_expires_at
      ? `  ⏰ expires ${formatDate(acc.token_expires_at)}`
      : '';
    return `${i + 1}\\. ${label} — \`${handle}\`${expiry}`;
  });

  const footer =
    `\n\n_${accounts.length} platform${accounts.length !== 1 ? 's' : ''} connected_`;

  return header + rows.join('\n') + footer;
}

// ── /link ─────────────────────────────────────────────────────

function linkPromptMessage() {
  return (
    `🔗 *Link Your Account*\n\n` +
    `To connect your AI Content account to Telegram, send your API token:\n\n` +
    `\`/link <your-api-token>\`\n\n` +
    `_You can generate a token in the web app under Settings → API Tokens\\._`
  );
}

function linkSuccessMessage(userName) {
  return (
    `✅ *Account linked successfully\\!*\n\n` +
    `Welcome, *${escMd(userName)}*\\!\n` +
    `Use /help to see what I can do\\.`
  );
}

function linkAlreadyLinkedMessage(userName) {
  return (
    `ℹ️ This Telegram account is already linked to *${escMd(userName)}*\\.\n` +
    `Use /accounts to see your connected platforms\\.`
  );
}

function linkInvalidTokenMessage() {
  return (
    `❌ *Invalid or expired token\\.*\n\n` +
    `Please generate a new token in the web app under _Settings → API Tokens_\\.`
  );
}

// ── Error messages ────────────────────────────────────────────

function genericErrorMessage() {
  return '⚠️ Something went wrong\\. Please try again in a moment\\.';
}

function notLinkedMessage() {
  return (
    `🔗 *Account not linked*\n\n` +
    `Use /link to connect your account before using this command\\.`
  );
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Escape special MarkdownV2 characters in user-supplied strings.
 * Safe to call on strings that may contain any characters.
 */
function escMd(str) {
  if (!str) return '';
  // MarkdownV2 special chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return String(str).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Format an ISO date string as a short human-readable date.
 */
function formatDate(isoString) {
  if (!isoString) return 'unknown';
  return new Date(isoString).toLocaleDateString('en-GB', {
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  });
}

module.exports = {
  startMessage,
  helpMessage,
  accountsMessage,
  linkPromptMessage,
  linkSuccessMessage,
  linkAlreadyLinkedMessage,
  linkInvalidTokenMessage,
  genericErrorMessage,
  notLinkedMessage,
  platformLabel,
  escMd,
};
