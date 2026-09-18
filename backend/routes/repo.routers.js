const express = require("express");
const repoController = require("../controllers/repo.js");
const { requireAuth } = require("../middlewares/authMiddleware.js");
const multer = require("multer");
const fs = require("fs").promises;
const path = require("path");

const repoRouter = express.Router();
const MAX_IMPORT_FILES = 10000;
const MAX_IMPORT_TRANSPORT_FILES = 12000;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const uploadStorage = {
  _handleFile(req, file, callback) {
    const chunks = [];
    let receivedBytes = 0;
    file.stream.on("data", (chunk) => {
      receivedBytes += chunk.length;
      chunks.push(chunk);
    });
    file.stream.on("limit", () => {
      console.error("Import file rejected:", file.originalname, "received bytes:", receivedBytes, "limit bytes:", MAX_IMPORT_FILE_BYTES);
    });
    file.stream.on("error", callback);
    file.stream.on("end", () => callback(null, { buffer: Buffer.concat(chunks), size: receivedBytes }));
  },
  _removeFile(req, file, callback) {
    delete file.buffer;
    callback(null);
  },
};
const importUpload = multer({
  storage: uploadStorage,
  limits: { files: MAX_IMPORT_TRANSPORT_FILES, fileSize: MAX_IMPORT_FILE_BYTES, fieldSize: 16 * 1024 * 1024 },
});

repoRouter.post("/repo/create", repoController.createRepository);
repoRouter.post("/repo/import", requireAuth, importUpload.array("files", MAX_IMPORT_TRANSPORT_FILES), repoController.importRepository, (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "A project file is too large." : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "Too many project files were selected." : "The project upload is too large.";
    return res.status(413).json({ error: message });
  }
  return next(err);
});

repoRouter.get("/repo/all", repoController.getAllRepositories);
repoRouter.get("/repo/commits", async (req, res) => {
  try {
    const remotePath = path.resolve(
      process.cwd(),
      "remoteRepo"
    );

    const commits = await fs.readdir(remotePath);

    res.json(commits);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

repoRouter.get("/repo/:id", repoController.fetchRepositoryById);
repoRouter.get("/repo/:id/files", repoController.fetchRepositoryFiles);
repoRouter.get("/repo/:id/download", requireAuth, repoController.downloadRepository);
repoRouter.get("/repo/:id/commits", requireAuth, repoController.listRepositoryCommits);
repoRouter.get("/repo/:id/commits/:commitId", requireAuth, repoController.getRepositoryCommit);
repoRouter.get("/repo/:id/commits/:commitId/diff", requireAuth, repoController.getRepositoryDiff);
repoRouter.get("/repo/:id/branches", requireAuth, repoController.listBranches);
repoRouter.post("/repo/:id/branches/:branchName", requireAuth, repoController.createBranch);
repoRouter.delete("/repo/:id/branches/:branchName", requireAuth, repoController.deleteBranch);
repoRouter.get("/repo/:id/pulls", requireAuth, repoController.listPullRequests);
repoRouter.post("/repo/:id/pulls", requireAuth, repoController.createPullRequest);
repoRouter.get("/repo/:id/pulls/:pullId", requireAuth, repoController.getPullRequest);
repoRouter.post("/repo/:id/pulls/:pullId/comments", requireAuth, repoController.addPullRequestComment);
repoRouter.get("/repo/:id/pulls/:pullId/diff", requireAuth, repoController.getPullRequestDiff);
repoRouter.post("/repo/:id/pulls/:pullId/ai-review", requireAuth, repoController.reviewPullRequest);
repoRouter.patch("/repo/:id/pulls/:pullId/close", requireAuth, repoController.closePullRequest);
repoRouter.post("/repo/:id/pulls/:pullId/merge", requireAuth, repoController.mergePullRequest);

repoRouter.get("/repo/name/:name", repoController.fetchRepositoryByName);

repoRouter.get("/repo/user/:userId", repoController.fetchRepositoriesForCurrentUser);

repoRouter.put("/repo/update/:id", repoController.updateRepositoryById);

repoRouter.put("/repo/star/:repoId/:userId", repoController.starRepository);


repoRouter.delete("/repo/delete/:id", repoController.deleteRepositoryById);
repoRouter.patch("/repo/toggle/:id", repoController.toggleVisibilityById);

module.exports = repoRouter;