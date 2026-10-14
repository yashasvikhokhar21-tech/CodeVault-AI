const { pullCommand } = require("../cli/commands");

async function pullrepo() {
  try {
    await pullCommand();
  } catch (err) {
    console.error("Error pulling repository:", err.message);
  }
}

module.exports = { pullrepo };