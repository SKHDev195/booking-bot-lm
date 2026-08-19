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
  client: local.client || {
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
  targetDate: local.targetDate || null,
  targetDaysAhead: 61,

  // Schedule: every 30 minutes, 08:00-18:30, Nicosia time, every day.
  // (Cron minute/hour fields; node-cron uses standard 5-field cron syntax.)
  // "0,30 8-18" fires at :00 and :30 for hours 08..18, so the last run is 18:30.
  cronSchedule: "0,30 8-18 * * *",
  timezone: "Asia/Nicosia",

  // Files used to persist state between runs.
  stateFile: "./state.json",
  logFile: "./bot.log",
  screenshotDir: "./screenshots",

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
