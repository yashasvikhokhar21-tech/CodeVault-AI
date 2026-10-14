const { commitCommand } = require("../cli/commands");

async function commitRepo(message) {
  try {
    await commitCommand(message);
  } catch (err) {
    console.error("Error committing files:", err.message);
  }
}

module.exports = { commitRepo };