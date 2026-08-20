# Limassol District Administration — booking watcher/bot

Watches this SimplyBook.it booking widget:
`https://limassoldistrictadmin.simplybook.it/v2/#book/service/8/count/1/provider/10/date/.../`

and automatically books **the first available slot on one fixed date**. That
date is either pinned explicitly (`targetDate` in `config.local.js`) or, if
left unset, computed once as **`targetDaysAhead` days ahead of when the bot
first ran** (currently 61, see `config.js`) and then persisted. The
bot does not shop around other dates — it keeps rechecking that single date,
08:00–18:30 Nicosia time, every day, until a slot is successfully booked. No
requests are made 00:00–08:00. Inside the active window it checks in bursts:
every `burstIntervalSeconds` (20s) in the `burstWindowMinutes` (2min) leading
up to each clean 30-minute mark (:00 / :30), then goes quiet right after the
mark until the next one's lead-in.

## ⚠️ Please read before running

This uses a real headless browser (Playwright) driving the actual booking
page the way a person would, because the page requires JavaScript and
cookies. `lib/booking.js` now uses the **exact CSS selectors and element IDs
taken from the site's own template source** (name/email/phone fields are
`#sb_client_name` / `#sb_client_email` / `#sb_client_phone`, time slots are
`a.sb-cell.free`, the submit button is `#sb_book_btn`, etc.) rather than
guessed English button text — this matters because the site is in Greek, so
any English-text matching would silently never fire.

Two things worth knowing:

- The site's own config shows appointments open on a **rolling ~2-month
  window** (e.g. as of a given day, bookings are only open up to about two
  months out). A date like Oct 20, 2026 won't show *any* slots until the
  window rolls forward to include it — that's expected, not a bug, and is
  exactly the kind of thing this bot is built to catch as soon as it happens.
- Government booking systems sometimes add CAPTCHAs specifically to block
  this kind of automation. If a CAPTCHA appears, this script will not be
  able to get past it, and you'll need to book manually — I did not build
  a CAPTCHA bypass.

**Run the test in headed mode first** (see below) so you can watch it and
confirm it correctly finds/clicks slots and fills the form, *before* you let
it run unattended and actually submit a real booking. Please also keep the
burst schedule (`burstIntervalSeconds` / `burstWindowMinutes` in `config.js`)
reasonable, so this doesn't look like abusive traffic to the site.

## 1. Install

```bash
cd limassol-booking-bot
npm install
npm run install-browsers   # downloads the Chromium browser Playwright drives
cp config.local.example.js config.local.js   # then edit it with your details
```

Your personal details (name / email / phone) and an optional pinned
`targetDate` live in **`config.local.js`**, which is gitignored and never
committed. The bot refuses to run until you've filled it in — the placeholder
values in `config.js` are intentionally invalid.

## 2. Test it in headed mode (watch it work)

This opens a real, visible Chrome window so you can see exactly what the
bot sees and does. It will check the single configured target date, and
**will actually attempt a real booking if it finds an open slot** — so
only do this if you're genuinely ready to book, or temporarily change
`targetDaysAhead` in `config.js` (and clear `targetDate` from `state.json`
if one was already saved) to a date you know is full, just to watch the
"no slots found" path safely.

```bash
npm run test-once
```

Check the `screenshots/` folder afterwards — a screenshot is saved every
time a slot is found and after every booking attempt, which is the fastest
way to see what the real page looks like and adjust selectors if needed.

## 3. Adjust selectors if needed

If the test run doesn't find slots that you can see are actually there, or
finds them but can't fill the form / click the right buttons, open
`lib/booking.js`. The parts most likely to need tweaking, based on what
you see in the screenshots and in the browser window, are:

- `TIME_LABEL_RE` — the pattern used to recognise a time-slot button label.
- `fillClientDetails()` — the CSS selectors used to find the name/email/phone
  fields.
- `clickPrimaryActionButton()` — the pattern used to recognise "Next" /
  "Confirm" / "Complete booking" type buttons.

Tip: with the browser open in headed mode, right-click any element →
"Inspect" to see its actual `name`, `id`, `class`, or button text, then
match that in the code.

## 4. Run for real, on a schedule

```bash
npm start
```

This runs an immediate check (if it's within a pre-mark burst window), then
follows the schedule in `config.js`: active 08:00–18:30 Asia/Nicosia,
checking every 20s in the 2 minutes leading up to each clean :00/:30 mark,
silent right after the mark, silent 00:00–08:00. Leave this process running.

To keep it running in the background reliably (so it survives you closing
the terminal, and restarts if your machine reboots), consider:

- **pm2** (simplest): `npm install -g pm2 && pm2 start index.js --name limassol-bot && pm2 save`
- or a systemd service / scheduled task, if you'd like — happy to write
  one if you tell me your OS.

## 5. What happens when it books successfully

- The script stops trying further dates and writes `state.json` with
  `"booked": true` plus the date/time it booked.
- Every subsequent scheduled check sees this and does nothing (so it won't
  double-book).
- The booking system itself emails the confirmation, so this bot doesn't
  send its own email — just check the inbox for the address configured in
  `config.local.js` after a run.
- If you ever want it to search again (e.g. you need to cancel and rebook),
  delete `state.json` (or set `"booked": false` in it) and restart.

## 6. If a slot is found but booking fails

The bot deliberately **stops and does not move on to other dates** if it
finds an open slot but can't confirm the booking (rather than risk missing
it while it keeps scanning). It logs the direct URL for that date/slot so
you can jump in and book it manually right away:

```
STOPPING: a slot was found but not successfully booked. ...
book it manually right now before it's gone: https://limassoldistrictadmin.simplybook.it/v2/#book/service/8/count/1/provider/10/date/2026-XX-XX/
```

## 7. Deploying on Railway (recommended for unattended running)

This bot is a long-running process (`node-cron` scheduler + Playwright), so it
needs a real host, not a serverless platform — [Railway](https://railway.app)
works well and keeps a persistent volume for `state.json`.

1. **Push this repo to GitHub**, then in Railway: New Project → Deploy from
   GitHub repo. Railway will pick up the `Dockerfile` / `railway.json` in
   this project automatically (Docker builder, no HTTP port needed — it's a
   worker, not a web service).
2. **Set environment variables** (Settings → Variables) — since
   `config.local.js` is gitignored and never reaches the server, use these
   instead:
   - `CLIENT_NAME`, `CLIENT_EMAIL`, `CLIENT_PHONE` — your real details.
   - `TARGET_DATE` — optional, `YYYY-MM-DD` to pin the watched date; leave
     unset to use `targetDaysAhead` (computed once, then persisted).
3. **Attach a Volume** (Settings → Volumes → New Volume, mount path e.g.
   `/data`). Railway sets `RAILWAY_VOLUME_MOUNT_PATH` automatically, and
   `config.js` uses it for `state.json` / `bot.log` / `screenshots/` so they
   survive redeploys. Without a volume, those reset on every deploy — you'd
   lose the "already booked" / pinned `targetDate` state.
4. **Deploy.** Check the Railway service logs — you should see the same
   startup lines as `npm start` locally. First deploy takes a few minutes
   longer since `npx playwright install --with-deps chromium` downloads the
   browser during the Docker build.
5. To watch the bot actually book something, either read the logs, or use
   Railway's shell (`railway run` / the web shell) to inspect
   `/data/state.json` and `/data/screenshots/`.

## Files

| File | Purpose |
|---|---|
| `config.js` | All the settings you'd want to change (dates, client info, schedule). |
| `index.js` | Long-running scheduler entry point. |
| `run-once.js` | Runs exactly one check-all-candidate-dates pass (also used for testing). |
| `lib/booking.js` | The Playwright logic: load a date, detect/click a slot, fill and submit the form. |
| `lib/dates.js` | Builds the ordered list of candidate dates, applying the weekday filter. |
| `lib/state.js` / `state.json` | Tracks whether a booking has already been secured. |
| `lib/logger.js` / `bot.log` | Timestamped logging, both to console and to file. |
| `screenshots/` | Auto-saved screenshots for debugging (slot found, after booking attempt, etc). |

## Configured details

- Client: set in `config.local.js` (kept out of version control)
- Service/provider: service `8`, provider `10`, party count `1`
- Watched date: a single fixed date — `targetDate` in `config.local.js` if set,
  otherwise `today + targetDaysAhead` (61) computed once on first run. The bot
  does **not** scan a range of dates or apply a weekday filter.
- Check schedule: active 08:00–18:30 Asia/Nicosia, every 20s in the 2min
  leading up to each clean 30-min mark (silent 00:00–08:00 and between marks)
- No separate email alert (relying on the booking system's own confirmation email)

> ⚠️ Earlier versions of this project committed the client's name/email/phone
> directly in `config.js`. Those values still exist in the git history. If that
> matters to you, rewrite history (e.g. `git filter-repo`) or start a fresh repo.
