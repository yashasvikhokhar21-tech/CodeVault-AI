const express = require("express");
const aiController = require("../controllers/ai.js");
const { requireAuth } = require("../middlewares/authMiddleware.js");

const aiRouter = express.Router();
aiRouter.use(requireAuth);
aiRouter.get("/ai/repositories/:repoId/changes", aiController.getBranchChanges);
aiRouter.post("/ai/repositories/:repoId/commit-message", aiController.commitMessage);
aiRouter.post("/ai/repositories/:repoId/review", aiController.codeReview);
aiRouter.post("/ai/issues/:issueId/analyze", aiController.issueAnalysis);
aiRouter.post("/ai/chat", aiController.assistantChat);

module.exports = aiRouter;