// ---------------------------------------------------------------------------
// Central configuration. Edit values here rather than in the scripts below.
//
// Personal details (name/email/phone) and, optionally, a fixed target date
// live in config.local.js, which is gitignored and NEVER committed. Copy
// config.local.example.js to config.local.js and fill it in. This keeps PII
// out of version control.
// ---------------------------------------------------------------------------

let local = {};
try {
  // eslint-disable-next-line import/no-unresolved
  local = require("./config.local");
} catch (e) {
  // No local overrides file present. The bot will refuse to run with the
  // placeholder client below (see run-once.js), so this is safe.
}

const path = require("path");

// On hosts like Railway, config.local.js (gitignored, holds PII) can't be
// copied onto the box, so fall back to environment variables. Precedence:
// config.local.js > env vars > invalid placeholders (which make the bot
// refuse to run).
const envClient =
  process.env.CLIENT_NAME && process.env.CLIENT_EMAIL && process.env.CLIENT_PHONE
    ? {
        name: process.env.CLIENT_NAME,
        email: process.env.CLIENT_EMAIL,
        phone: process.env.CLIENT_PHONE,
      }
    : null;

// If a Railway Volume is attached, RAILWAY_VOLUME_MOUNT_PATH is set
// automatically and state/log/screenshots persist there across deploys.
// Locally (no volume) this stays "." so behaviour is unchanged.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || ".";

module.exports = {
  // The company/widget details, taken from the URL you gave me:
  // https://limassoldistrictadmin.simplybook.it/v2/#book/service/8/count/1/provider/10/date/2026-10-01/
  companyDomain: "limassoldistrictadmin.simplybook.it",
  serviceId: "8",
  providerId: "10",
  partyCount: "1",

  // Builds the widget URL for a given date (YYYY-MM-DD string).
  buildUrl(dateStr) {
    return `https://${this.companyDomain}/v2/#book/service/${this.serviceId}/count/${this.partyCount}/provider/${this.providerId}/date/${dateStr}/`;
  },

  // The person the appointment is for. Real values come from config.local.js;
  // these placeholders are intentionally invalid so the bot won't submit a
  // booking with dummy details.
  client: local.client || envClient || {
    name: "YOUR NAME",
    email: "you@example.com",
    phone: "+3579XXXXXXX",
  },

  // Which single date the bot watches.
  //
  // If config.local.js sets an explicit `targetDate` (YYYY-MM-DD), that exact
  // date is used, deterministically — it survives deleting state.json.
  //
  // Otherwise the bot computes `today + targetDaysAhead` ONCE on first run and
  // persists it in stateFile (as targetDate). Note: deleting state.json makes
  // that computed value recompute against a new "today", so pin `targetDate`
  // in config.local.js if you want a stable date.
  targetDate: local.targetDate || process.env.TARGET_DATE || null,
  targetDaysAhead: 61,

  // Active window: no requests at all outside these hours (Nicosia time).
  // activeHourEnd is inclusive and paired with a :30 mark, so the last burst
  // of the day starts at activeHourEnd:30 (18:30 by default).
  activeHourStart: 8,
  activeHourEnd: 18,

  // In the `burstWindowMinutes` immediately BEFORE each clean 30-minute mark
  // (:00 / :30) inside the active window, re-check every
  // `burstIntervalSeconds`. At the mark itself and for the rest of the
  // 30-minute block, it goes quiet again until the next mark's lead-in.
  burstIntervalSeconds: 20,
  burstWindowMinutes: 2,

  timezone: "Asia/Nicosia",

  // Files used to persist state between runs. Under a Railway Volume
  // (dataDir set via RAILWAY_VOLUME_MOUNT_PATH) these live on that volume
  // so they survive redeploys; locally they stay in the project folder.
  stateFile: path.join(dataDir, "state.json"),
  logFile: path.join(dataDir, "bot.log"),
  screenshotDir: path.join(dataDir, "screenshots"),

  // Playwright behaviour
  browser: {
    // Keep this true for unattended/scheduled runs. The test script
    // (npm run test-once) forces headed mode regardless of this value.
    headless: true,
    // Slows down actions slightly so the site's own JS has time to react.
    slowMoMs: 150,
    navigationTimeoutMs: 45000,
  },
};
