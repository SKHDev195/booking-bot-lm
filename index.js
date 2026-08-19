const cron = require("node-cron");
const { execFile } = require("child_process");
const path = require("path");
const config = require("./config");
const { log } = require("./lib/logger");
const state = require("./lib/state");
const { getTargetDate } = require("./lib/dates");

log(
  `Scheduler starting. Cron: "${config.cronSchedule}" (${config.timezone}). ` +
    `Watching ${getTargetDate()}.`
);

function runCheck() {
  const current = state.load();
  if (current.booked) {
    log(`Booking already secured (${current.bookedDate} ${current.bookedTime}). Scheduler idle.`);
    return;
  }

  log("Cron tick: launching a check pass (run-once.js)...");
  const child = execFile(
    process.execPath,
    [path.join(__dirname, "run-once.js")],
    { cwd: __dirname },
    (error) => {
      if (error) {
        log("run-once.js exited with an error:", error.message);
      }
    }
  );
  child.stdout && child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr && child.stderr.on("data", (d) => process.stderr.write(d));
}

// Run once immediately on startup, then follow the cron schedule.
runCheck();

cron.schedule(config.cronSchedule, runCheck, { timezone: config.timezone });

log("Scheduler is running. Leave this process running (see README for pm2/systemd tips). Ctrl+C to stop.");
