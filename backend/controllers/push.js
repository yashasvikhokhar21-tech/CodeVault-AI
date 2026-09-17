const fs = require("fs").promises;
const path = require("path");

async function pushRepo() {
  const commitsPath = path.resolve(
    process.cwd(),
    ".hiddenGit",
    "commits"
  );

  const remotePath = path.resolve(
    process.cwd(),
    "remoteRepo"
  );

  try {
    await fs.mkdir(remotePath, {
      recursive: true,
    });

    const commits = await fs.readdir(commitsPath);

    if (commits.length === 0) {
      console.log("No commits to push");
      return;
    }

    for (const commit of commits) {
      const source = path.join(
        commitsPath,
        commit
      );

      const destination = path.join(
        remotePath,
        commit
      );

      await fs.cp(source, destination, {
        recursive: true,
      });
    }

    console.log("Push successful!");
  } catch (err) {
    console.error("Push failed:", err);
  }
}

module.exports = { pushRepo };