const cron = require("node-cron");
const { execFile } = require("child_process");
const path = require("path");
const config = require("./config");
const { log } = require("./lib/logger");
const state = require("./lib/state");
const { getTargetDate } = require("./lib/dates");

// Ticks every burstIntervalSeconds, all day — isInPreMarkBurstWindow() below
// does the real filtering (blocked overnight hours + which marks are valid),
// since the burst windows lead INTO each mark and so cross hour boundaries
// (e.g. 08:58-08:59:59 leads into the 09:00 mark) in ways a cron hour-range
// can't express cleanly on its own.
const tickCron = `*/${config.burstIntervalSeconds} * * * * *`;
const burstWindowSeconds = config.burstWindowMinutes * 60;
const HALF_HOUR_SECONDS = 1800;

log(
  `Scheduler starting. Active window: ${String(config.activeHourStart).padStart(2, "0")}:00-` +
    `${String(config.activeHourEnd).padStart(2, "0")}:30 (${config.timezone}), checking every ` +
    `${config.burstIntervalSeconds}s in the ${config.burstWindowMinutes}min leading up to each ` +
    `clean 30-min mark. Watching ${getTargetDate()}.`
);

/** Current {hour, minute, second} in the configured timezone. */
function nowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: get("hour"), minute: get("minute"), second: get("second") };
}

/**
 * True in the burstWindowMinutes immediately BEFORE the next clean :00/:30
 * mark — but only if that upcoming mark itself falls inside the active
 * window (activeHourStart:00 exclusive, since its lead-in sits in the
 * blocked overnight hours anyway, through activeHourEnd:30 inclusive).
 */
function isInPreMarkBurstWindow({ hour, minute, second }) {
  const nowSeconds = hour * 3600 + minute * 60 + second;
  const nextMarkSeconds = Math.ceil(nowSeconds / HALF_HOUR_SECONDS) * HALF_HOUR_SECONDS;
  const timeUntilMark = nextMarkSeconds - nowSeconds;
  if (timeUntilMark <= 0 || timeUntilMark > burstWindowSeconds) return false;

  const markMinutesSinceMidnight = (nextMarkSeconds / 60) % (24 * 60);
  return (
    markMinutesSinceMidnight > config.activeHourStart * 60 &&
    markMinutesSinceMidnight <= config.activeHourEnd * 60 + 30
  );
}

let checking = false;

function runCheck() {
  const current = state.load();
  if (current.booked) {
    log(`Booking already secured (${current.bookedDate} ${current.bookedTime}). Scheduler idle.`);
    return;
  }

  if (checking) {
    log("Previous check pass is still running — skipping this tick.");
    return;
  }
  checking = true;

  log("Tick: launching a check pass (run-once.js)...");
  const child = execFile(
    process.execPath,
    [path.join(__dirname, "run-once.js")],
    { cwd: __dirname },
    (error) => {
      checking = false;
      if (error) {
        log("run-once.js exited with an error:", error.message);
      }
    }
  );
  child.stdout && child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr && child.stderr.on("data", (d) => process.stderr.write(d));
}

function onCronTick() {
  if (isInPreMarkBurstWindow(nowParts())) runCheck();
}

// Run once immediately on startup, but only if we're already inside a
// pre-mark burst window — avoids a stray check right after a deploy at,
// say, 2am or in the middle of an idle 30-minute block.
if (isInPreMarkBurstWindow(nowParts())) runCheck();

cron.schedule(tickCron, onCronTick, { timezone: config.timezone });

log("Scheduler is running. Leave this process running (see README for pm2/systemd tips). Ctrl+C to stop.");
