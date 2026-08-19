const fs = require("fs");
const config = require("../config");

function load() {
  try {
    const raw = fs.readFileSync(config.stateFile, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {
      booked: false,
      bookedDate: null,
      bookedTime: null,
      lastRunAt: null,
      lastError: null,
      targetDate: null,
    };
  }
}

function save(state) {
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
}

module.exports = { load, save };
