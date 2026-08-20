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
    `${config.burstIntervalSeconds}s from ${config.burstWindowMinutes}min before to ` +
    `${config.burstWindowMinutes}min after each clean 30-min mark. Watching ${getTargetDate()}.`
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

// Valid marks run from activeHourStart:00 through activeHourEnd:30 inclusive.
const FIRST_MARK_MINUTES = config.activeHourStart * 60;
const LAST_MARK_MINUTES = config.activeHourEnd * 60 + 30;

/**
 * True in the burstWindowMinutes on EITHER side of the nearest clean
 * :00/:30 mark — but only the sides that don't leak into blocked time:
 * the lead-in to the very first mark of the day is excluded (it would sit
 * in the blocked 00:00-activeHourStart hours), and the lead-in to the mark
 * just past the last one is excluded (that mark doesn't exist). The
 * trailing side of the last mark itself is fine and included.
 */
function isInBurstWindow({ hour, minute, second }) {
  const nowSeconds = hour * 3600 + minute * 60 + second;
  const blockStartSeconds = Math.floor(nowSeconds / HALF_HOUR_SECONDS) * HALF_HOUR_SECONDS;
  const blockEndSeconds = blockStartSeconds + HALF_HOUR_SECONDS;

  const afterDist = nowSeconds - blockStartSeconds; // 0..1799, since the last mark
  const beforeDist = blockEndSeconds - nowSeconds; // 1..1800, since the next mark

  const blockStartMinutes = (blockStartSeconds / 60) % (24 * 60);
  const blockEndMinutes = (blockEndSeconds / 60) % (24 * 60);

  const afterOk =
    afterDist < burstWindowSeconds &&
    blockStartMinutes >= FIRST_MARK_MINUTES &&
    blockStartMinutes <= LAST_MARK_MINUTES;
  const beforeOk =
    beforeDist <= burstWindowSeconds &&
    blockEndMinutes > FIRST_MARK_MINUTES &&
    blockEndMinutes <= LAST_MARK_MINUTES;

  return afterOk || beforeOk;
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
  if (isInBurstWindow(nowParts())) runCheck();
}

// Run once immediately on startup, but only if we're already inside a
// pre-mark burst window — avoids a stray check right after a deploy at,
// say, 2am or in the middle of an idle 30-minute block.
if (isInBurstWindow(nowParts())) runCheck();

cron.schedule(tickCron, onCronTick, { timezone: config.timezone });

log("Scheduler is running. Leave this process running (see README for pm2/systemd tips). Ctrl+C to stop.");
