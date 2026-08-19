const cron = require("node-cron");
const { execFile } = require("child_process");
const path = require("path");
const config = require("./config");
const { log } = require("./lib/logger");
const state = require("./lib/state");
const { getTargetDate } = require("./lib/dates");

// Fires every burstIntervalSeconds, but only during activeHourStart..activeHourEnd
// (inclusive) — outside that range we don't want the process waking up at all.
const tickCron = `*/${config.burstIntervalSeconds} * ${config.activeHourStart}-${config.activeHourEnd} * * *`;
const burstWindowSeconds = config.burstWindowMinutes * 60;

log(
  `Scheduler starting. Active window: ${String(config.activeHourStart).padStart(2, "0")}:00-` +
    `${String(config.activeHourEnd).padStart(2, "0")}:30 (${config.timezone}), checking every ` +
    `${config.burstIntervalSeconds}s for ${config.burstWindowMinutes}min after each clean 30-min ` +
    `mark. Watching ${getTargetDate()}.`
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

/** True in the burstWindowMinutes right after each clean :00/:30 mark. */
function isInBurstWindow({ minute, second }) {
  const secondsSinceMark = (minute % 30) * 60 + second;
  return secondsSinceMark < burstWindowSeconds;
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
  const parts = nowParts();
  if (isInBurstWindow(parts)) runCheck();
}

// Run once immediately on startup (only if we're inside the active window and
// burst period — avoids a stray check right after a deploy at, say, 2am or
// 14 minutes past a mark), then follow the cron schedule.
{
  const parts = nowParts();
  const inActiveHours = parts.hour >= config.activeHourStart && parts.hour <= config.activeHourEnd;
  if (inActiveHours && isInBurstWindow(parts)) runCheck();
}

cron.schedule(tickCron, onCronTick, { timezone: config.timezone });

log("Scheduler is running. Leave this process running (see README for pm2/systemd tips). Ctrl+C to stop.");
