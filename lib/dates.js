const config = require("../config");
const state = require("./state");

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

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

/** True if the given YYYY-MM-DD is strictly before today (configured tz). */
function isPastDate(dateStr) {
  return dateStr < todayStr();
}

/**
 * Returns the single date (YYYY-MM-DD) the bot watches.
 *
 * - If config.targetDate is set (from config.local.js), it wins and is fully
 *   deterministic — it survives deleting state.json.
 * - Otherwise the value is config.targetDaysAhead days ahead of the day it
 *   first ran, computed once and persisted in stateFile (as targetDate) so
 *   cron ticks keep checking the same date instead of drifting with "today".
 *   (Deleting state.json will recompute this against a new "today".)
 */
function getTargetDate() {
  if (config.targetDate) return config.targetDate;

  const current = state.load();
  if (current.targetDate) return current.targetDate;

  // Parse as UTC midnight to avoid local-timezone off-by-one issues.
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + config.targetDaysAhead);
  const targetDate = toDateStr(cursor);

  state.save({ ...current, targetDate });
  return targetDate;
}

module.exports = { getTargetDate, isPastDate };
