const { addCommand } = require("../cli/commands");

async function addRepo(filePath) {
  try {
    await addCommand(filePath ? [filePath] : ["."]);
  } catch (err) {
    console.error("Error adding file:", err.message);
  }
}

module.exports = { addRepo };