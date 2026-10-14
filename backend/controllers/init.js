const { initCommand } = require("../cli/commands");

async function initRepo() {
  try {
    await initCommand();
  } catch (err) {
    console.error("Error initialising repository:", err.message);
  }
}

module.exports = { initRepo };
