const { chromium } = require("playwright");
const config = require("./config");
const { log } = require("./lib/logger");
const state = require("./lib/state");
const { getTargetDate, isPastDate } = require("./lib/dates");
const { checkAndBookDate } = require("./lib/booking");

const FORCE_HEADED = process.argv.includes("--headed");

function clientConfigured() {
  const { name, email, phone } = config.client;
  if (!name || !email || !phone) return false;
  // Reject the placeholders shipped in config.js.
  if (/example\.com$/i.test(email)) return false;
  if (/^YOUR NAME$/i.test(name)) return false;
  return true;
}

async function runOnce() {
  const current = state.load();
  if (current.booked) {
    log(
      `Already booked ${current.bookedDate} at ${current.bookedTime} (see ${config.stateFile}). ` +
        `Skipping. Delete/edit ${config.stateFile} if you want the bot to search again.`
    );
    return;
  }

  if (!clientConfigured()) {
    log(
      "Refusing to run: client details are not configured. Copy " +
        "config.local.example.js to config.local.js and fill in your name/email/phone."
    );
    return;
  }

  const dateStr = getTargetDate();

  // Never silently poll a date that has already passed — that can never book
  // and just hammers the site forever. Stop and make the situation loud.
  if (isPastDate(dateStr)) {
    const msg =
      `STOPPING: the watched date ${dateStr} is in the past and can never be booked. ` +
      `Set a future targetDate in config.local.js (or delete ${config.stateFile} to ` +
      `recompute from targetDaysAhead), then restart.`;
    log(msg);
    state.save({ ...current, lastRunAt: new Date().toISOString(), lastError: msg });
    return;
  }
  // Reload state: getTargetDate() may have just persisted a new targetDate,
  // and `current` (loaded above) would otherwise be stale and overwrite it
  // on every state.save() below.
  Object.assign(current, state.load());
  log(`Starting run. Watching a single fixed date: ${dateStr}.`);

  const browser = await chromium.launch({
    headless: FORCE_HEADED ? false : config.browser.headless,
    slowMo: config.browser.slowMoMs,
    // Some container sandboxes (seen on Railway) kill Chromium with SIGTRAP
    // the instant it launches, before Playwright's defaults (--no-sandbox
    // etc.) even get a usable browser back. --no-zygote/--single-process
    // avoid the multi-process startup path that trips this.
    args: ["--no-zygote", "--single-process", "--disable-gpu"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    let result;
    try {
      result = await checkAndBookDate(page, dateStr);
    } catch (err) {
      log(`  Error while checking ${dateStr}: ${err.message}`);
      state.save({ ...current, lastRunAt: new Date().toISOString(), lastError: err.message });
      return;
    }

    if (result.available && result.booked) {
      const confirmedDate = result.actualDate || dateStr;
      state.save({
        ...current,
        booked: true,
        bookedDate: confirmedDate,
        bookedTime: result.time,
        lastRunAt: new Date().toISOString(),
        lastError: null,
      });
      log(`Done — booking secured for ${confirmedDate} at ${result.time}. The bot will not run again.`);
      return;
    }

    if (result.available && !result.booked) {
      // A slot existed but we couldn't complete the booking automatically.
      // Stop here rather than silently letting the slot be taken by
      // continuing to poll — this needs a human look.
      const where = result.actualDate && result.actualDate !== dateStr
        ? `${result.actualDate} (requested ${dateStr})`
        : dateStr;
      state.save({
        ...current,
        lastRunAt: new Date().toISOString(),
        lastError:
          `Slot found on ${where} at ${result.time} but booking could not be confirmed automatically` +
          (result.reason ? ` (${result.reason}).` : "."),
      });
      log(
        "STOPPING: a slot was found but not successfully booked. Please check the screenshots in " +
          `${config.screenshotDir} and fix the form-filling logic, or book it manually right now before it's gone: ` +
          config.buildUrl(dateStr)
      );
      return;
    }

    log(`Run finished — no available slots on ${dateStr} this time. Will check again next cron tick.`);
    state.save({ ...current, lastRunAt: new Date().toISOString(), lastError: null });
  } finally {
    await browser.close();
  }
}

runOnce()
  .then(() => process.exit(0))
  .catch((err) => {
    log("Fatal error:", err.stack || err.message);
    process.exit(1);
  });
