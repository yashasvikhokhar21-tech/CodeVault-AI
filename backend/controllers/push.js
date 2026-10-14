const { pushCommand } = require("../cli/commands");

async function pushRepo() {
  try {
    await pushCommand();
  } catch (err) {
    console.error("Error pushing repository:", err.message);
  }
}

module.exports = { pushRepo };