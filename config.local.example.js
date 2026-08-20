// ---------------------------------------------------------------------------
// Copy this file to `config.local.js` and fill in your real details.
//
//   cp config.local.example.js config.local.js
//
// `config.local.js` is gitignored and must never be committed — it holds
// personal data (name / email / phone). config.js reads it automatically.
// ---------------------------------------------------------------------------

module.exports = {
  client: {
    name: "Your Full Name",
    email: "you@example.com",
    phone: "99999999",
  },

  // Optional: pin the exact date to watch, e.g. "2026-10-20".
  // If set, it is used verbatim and survives deleting state.json.
  // Leave as null to use config.targetDaysAhead (today + N days, computed once).
  targetDate: null,
};
