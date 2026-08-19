const fs = require("fs");
const config = require("../config");

function timestamp() {
  return new Date().toLocaleString("en-GB", { timeZone: config.timezone });
}

function log(...args) {
  const line = `[${timestamp()}] ${args.join(" ")}`;
  console.log(line);
  try {
    fs.appendFileSync(config.logFile, line + "\n");
  } catch (e) {
    // If we can't write the log file, don't crash the bot over it.
    console.error("(could not write to log file)", e.message);
  }
}

module.exports = { log };
