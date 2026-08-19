const fs = require("fs");
const path = require("path");
const config = require("../config");
const { log } = require("./logger");

// ---------------------------------------------------------------------------
// These selectors were taken directly from the site's own template source
// (the Handlebars templates SimplyBook.it renders into the page), which the
// user provided. Using structural classes/IDs instead of matching English
// button text means this works regardless of the site's language (the site
// is in Greek).
//
// Relevant snippets from the site's own templates:
//
//   time_slot_view:        <a class="sb-cell free ..." href="#...">HH:MM</a>
//   time_slots_weekly_item_view / time_flexible_hour_item_view /
//   time_classes_time_item_view: same "sb-cell free" pattern for every
//     timeline display mode (modern / weekly / flexible / classes).
//   empty_time_part:       <div class="alert alert--no-slots ...">
//   empty_week_time_part:  <div class="empty-week-time-part">
//   details_info_view:     <input id="sb_client_name" name="client_name">
//                           <input id="sb_client_email" name="client_email">
//                           <input id="sb_client_phone" name="client_phone">
//                           <div id="sb_book_btn" role="button">{{book_btn_title}}</div>
//   client_info_view (standalone variant): same IDs, name="name"/"email"/"phone"
//   cookies_block:          <a id="sb_accept_important_coo">I accept cookies</a>
//   booking_result_popup:   <div id="booking-result-popup"> ... status-{{status}} ...
//                           error state uses fa-exclamation-triangle icon;
//                           success/pending/paid/delay/reschedule_success all
//                           use fa-check-circle or the payment-pending icon.
// ---------------------------------------------------------------------------

const SLOT_SELECTOR = "a.sb-cell.free";

const NO_SLOTS_SELECTOR =
  ".alert--no-slots, .empty-week-time-part, .empty-step, .empty-provider, .empty-service";

const CLIENT_NAME_SELECTORS = ["#sb_client_name"];
const CLIENT_EMAIL_SELECTORS = ["#sb_client_email"];
const CLIENT_PHONE_SELECTORS = ["#sb_client_phone"];

const SUBMIT_SELECTORS = ["#sb_book_btn", "#sb_submit"];

const COOKIE_ACCEPT_SELECTORS = ["#sb_accept_important_coo", "#sb_necessary_important_coo"];

const RESULT_POPUP_SELECTOR = "#booking-result-popup";
// The site's templates render the error state with fa-exclamation-triangle and
// every success-ish state (success/pending/paid/delay/reschedule_success) with
// fa-check-circle (or a payment-pending icon). We require a POSITIVE success
// signal — never "absence of the error icon" — so an unknown/ambiguous popup is
// never mistaken for a confirmed booking.
const RESULT_ERROR_ICON_SELECTOR = `${RESULT_POPUP_SELECTOR} .fa-exclamation-triangle`;
const RESULT_SUCCESS_ICON_SELECTOR = `${RESULT_POPUP_SELECTOR} .fa-check-circle, ${RESULT_POPUP_SELECTOR} .fa-clock-o, ${RESULT_POPUP_SELECTOR} .fa-clock`;
const RESULT_SUCCESS_STATUS_SELECTOR = `${RESULT_POPUP_SELECTOR}.status-success, ${RESULT_POPUP_SELECTOR} .status-success, ${RESULT_POPUP_SELECTOR}.status-confirmed, ${RESULT_POPUP_SELECTOR} .status-confirmed`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page, label) {
  try {
    ensureDir(config.screenshotDir);
    const file = path.join(
      config.screenshotDir,
      `${Date.now()}-${label.replace(/[^a-z0-9-_]/gi, "_")}.png`
    );
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (e) {
    log("  (could not save screenshot:", e.message, ")");
    return null;
  }
}

async function clickFirstVisible(page, selectors, timeout = 3000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout })) {
        await el.click();
        return sel;
      }
    } catch (e) {
      // try next selector
    }
  }
  return null;
}

async function dismissCookieConsent(page) {
  const clicked = await clickFirstVisible(page, COOKIE_ACCEPT_SELECTORS, 5000);
  if (clicked) log(`  Dismissed cookie-consent prompt (${clicked}).`);
}

async function waitOutQueue(page) {
  // Defensive fallback only — this text appeared in one manual fetch of the
  // page but doesn't seem to be part of the real widget's own templates.
  // Kept as a short, non-blocking check in case a queueing layer sits in
  // front of the site under load.
  const start = Date.now();
  const timeout = 15000;
  while (Date.now() - start < timeout) {
    const bodyText = await page.evaluate(() => document.body.innerText || "");
    if (!/queue to make a booking|please wait/i.test(bodyText)) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

async function fillIfPresent(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.fill(value);
        return true;
      }
    } catch (e) {
      // try next selector
    }
  }
  return false;
}

/**
 * Best-effort read of the date a slot element belongs to. SimplyBook encodes
 * the date in the slot anchor's href/data-* attributes; if we can find a
 * YYYY-MM-DD there we can detect the site clamping to a different date.
 * Returns null if no date can be determined (in which case we don't second-
 * guess the requested date).
 */
async function readSlotDate(slotLocator) {
  return slotLocator
    .evaluate((el) => {
      const candidates = [
        el.getAttribute("href"),
        el.getAttribute("data-date"),
        el.getAttribute("data-datetime"),
        el.getAttribute("data-day"),
        el.dataset ? el.dataset.date : null,
      ];
      for (const c of candidates) {
        if (!c) continue;
        const m = String(c).match(/\d{4}-\d{2}-\d{2}/);
        if (m) return m[0];
      }
      return null;
    })
    .catch(() => null);
}

async function fillClientDetails(page) {
  const { name, email, phone } = config.client;
  const filledName = await fillIfPresent(page, CLIENT_NAME_SELECTORS, name);
  const filledEmail = await fillIfPresent(page, CLIENT_EMAIL_SELECTORS, email);
  const filledPhone = await fillIfPresent(page, CLIENT_PHONE_SELECTORS, phone);
  log(
    `  Client form fields filled — name: ${filledName}, email: ${filledEmail}, phone: ${filledPhone}`
  );
  // Require phone too: this widget exposes #sb_client_phone and rejects the
  // submit without it, so proceeding on name+email alone would submit a form
  // that silently fails validation.
  return filledName && filledEmail && filledPhone;
}

/**
 * After a slot is clicked, SimplyBook navigates straight to the details step
 * (name/email/phone + a "book" action) in this theme, rather than a
 * multi-step wizard. Fill the form and submit once.
 */
async function completeBookingFlow(page) {
  await page.waitForTimeout(1500);

  const filled = await fillClientDetails(page);
  if (!filled) {
    log("  Could not find the client detail fields (#sb_client_name / #sb_client_email).");
    return false;
  }

  const clickedSubmit = await clickFirstVisible(page, SUBMIT_SELECTORS, 3000);
  if (!clickedSubmit) {
    log("  Could not find the submit button (#sb_book_btn / #sb_submit).");
    return false;
  }
  log(`  Clicked submit (${clickedSubmit}).`);

  // Wait for the result popup (#booking-result-popup) to appear.
  try {
    await page.locator(RESULT_POPUP_SELECTOR).first().waitFor({ timeout: 15000 });
  } catch (e) {
    log("  No booking result popup appeared within 15s.");
    return false;
  }

  await page.waitForTimeout(500);

  const popupText = await page
    .locator(RESULT_POPUP_SELECTOR)
    .first()
    .innerText()
    .catch(() => "(could not read popup text)");

  const hasErrorIcon = await page
    .locator(RESULT_ERROR_ICON_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);

  if (hasErrorIcon) {
    log(`  Booking result popup shows an error: ${popupText}`);
    return false;
  }

  // Positive confirmation required: a success icon or a success status class
  // must be present. If we can't find one, treat the booking as NOT confirmed
  // rather than assuming success from the mere absence of the error icon.
  const hasSuccessIcon = await page
    .locator(RESULT_SUCCESS_ICON_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);
  const hasSuccessStatus = await page
    .locator(RESULT_SUCCESS_STATUS_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);

  if (!hasSuccessIcon && !hasSuccessStatus) {
    log(
      "  Booking result popup did not show a positive success confirmation " +
        `(no success icon/status). Treating as NOT booked. Popup text: ${popupText}`
    );
    return false;
  }

  return true;
}

/**
 * Checks a single date for availability, and books the first open slot if
 * one exists. Returns:
 *   { available: false }
 *   { available: true, booked: true, time }
 *   { available: true, booked: false, time, reason }
 */
async function checkAndBookDate(page, dateStr) {
  const url = config.buildUrl(dateStr);
  log(`Checking ${dateStr} -> ${url}`);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.browser.navigationTimeoutMs,
  });

  await dismissCookieConsent(page);
  await waitOutQueue(page);

  // Give the SPA a moment to render the calendar/time step.
  await page.waitForTimeout(3000);

  const noSlotsVisible = await page
    .locator(NO_SLOTS_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);
  if (noSlotsVisible) {
    log(`  ${dateStr}: no slots (empty-state element present).`);
    return { available: false };
  }

  const slotLocator = page.locator(SLOT_SELECTOR).first();
  const hasSlot = await slotLocator.isVisible().catch(() => false);
  if (!hasSlot) {
    log(`  ${dateStr}: no "a.sb-cell.free" elements found — treating as no slots.`);
    await screenshot(page, `no-slot-found-${dateStr}`);
    return { available: false };
  }

  const slotLabel = (await slotLocator.innerText().catch(() => "")).trim() || "unknown-time";

  // Guard against the site clamping our requested date to a different open
  // date (common when the requested date is outside the rolling booking
  // window). If the slot element carries a date and it doesn't match what we
  // asked for, do NOT book it silently — that would record the wrong date.
  const slotDate = await readSlotDate(slotLocator);
  if (slotDate && slotDate !== dateStr) {
    log(
      `  MISMATCH: requested ${dateStr} but the available slot is for ${slotDate} ` +
        `(the site likely clamped the date). Not booking automatically.`
    );
    await screenshot(page, `date-mismatch-${dateStr}-vs-${slotDate}`);
    return {
      available: true,
      booked: false,
      time: slotLabel,
      actualDate: slotDate,
      reason: "requested date not available; site showed a different date",
    };
  }

  const bookedDate = slotDate || dateStr;
  log(`  ${dateStr}: found an available slot at ${slotLabel}. Attempting to book...`);
  await screenshot(page, `slot-found-${dateStr}-${slotLabel}`);

  await slotLocator.click();

  const booked = await completeBookingFlow(page);
  const shot = await screenshot(page, `after-booking-attempt-${dateStr}-${slotLabel}`);

  if (booked) {
    log(`  SUCCESS: booked ${bookedDate} at ${slotLabel}. Screenshot: ${shot}`);
    return { available: true, booked: true, time: slotLabel, actualDate: bookedDate };
  }

  log(
    `  Slot at ${slotLabel} on ${bookedDate} was found but booking could not be confirmed. ` +
      `Check the screenshot (${shot}). URL for manual booking: ${url}`
  );
  return {
    available: true,
    booked: false,
    time: slotLabel,
    actualDate: bookedDate,
    reason: "could not confirm booking",
  };
}

module.exports = { checkAndBookDate };
