const config = require("../config");

/** "Today" as a YYYY-MM-DD string in the configured timezone. */
function todayStr() {
  // en-CA formats as YYYY-MM-DD, and lexicographic comparison of ISO date
  // strings matches chronological order.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Adds `days` to a YYYY-MM-DD string and returns a YYYY-MM-DD string. */
function addDays(dateStr, days) {
  // Parse as UTC midnight so the arithmetic never shifts with the host's
  // own timezone or DST changes.
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True if the given YYYY-MM-DD is strictly before today (configured tz). */
function isPastDate(dateStr) {
  return dateStr < todayStr();
}

/**
 * Returns the single date (YYYY-MM-DD) the bot watches on this run.
 *
 * - If config.targetDate is set (config.local.js or TARGET_DATE), it wins
 *   and stays fixed.
 * - Otherwise it rolls: today (in config.timezone) + config.targetDaysAhead,
 *   recomputed on every run, so the watched date moves forward one day each
 *   day. Nothing is persisted, so state.json has no effect on the date.
 */
function getTargetDate() {
  if (config.targetDate) return config.targetDate;
  return addDays(todayStr(), config.targetDaysAhead);
}

module.exports = { getTargetDate, isPastDate };
