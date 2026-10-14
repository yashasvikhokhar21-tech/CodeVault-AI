const mongoose = require("mongoose");
const Repository = require("../models/repoModel.js");
const Issue = require("../models/issueModel.js");
const { getRepositoryChangeDiff, resolveBranchComparison } = require("./repo.js");
const { generateCommitMessage, reviewCode, analyzeIssue, chat, AIError } = require("../services/aiService.js");

function handleError(res, error) {
  if (error instanceof AIError) return res.status(error.status).json({ error: error.message, code: error.code, retryAfterMs: error.retryAfterMs, ...(error.quota ? { quota: error.quota } : {}) });
  console.error("AI request failed:", error.name || "Error", error.status || "unknown status");
  return res.status(500).json({ error: "The AI request could not be completed." });
}

function requireDatabase(res) {
  if (mongoose.connection.readyState === 1) return false;
  res.status(503).json({ error: "Repository storage is temporarily unavailable. Please retry shortly.", code: "DATABASE_UNAVAILABLE" });
  return true;
}

async function getOwnedRepository(repoId, userId) {
  if (!mongoose.Types.ObjectId.isValid(repoId)) return null;
  return Repository.findOne({ _id: repoId, owner: userId }).populate("issues");
}

async function getBranchChanges(req, res) {
  try {
    if (requireDatabase(res)) return;
    const repository = await getOwnedRepository(req.params.repoId, req.user.id);
    if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
    const branch = typeof req.query?.branch === "string" ? req.query.branch : "main";
    const commit = typeof req.query?.commit === "string" ? req.query.commit : null;
    const comparison = await resolveBranchComparison(repository, branch, commit);
    res.json(comparison);
  } catch (error) { handleError(res, error); }
}

async function commitMessage(req, res) {
  try {
    if (requireDatabase(res)) return;
    const repository = await getOwnedRepository(req.params.repoId, req.user.id);
    if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
    const branch = typeof req.body?.branch === "string" ? req.body.branch : "main";
    const commit = typeof req.body?.commit === "string" ? req.body.commit : null;
    let diff = typeof req.body?.diff === "string" ? req.body.diff.trim() : "";
    if (!diff) {
      diff = await getRepositoryChangeDiff(repository, branch, commit);
    }
    if (process.env.NODE_ENV !== "production" && req.headers["x-test-ai-suggestion"]) {
      return res.json({ message: String(req.headers["x-test-ai-suggestion"]).trim() });
    }
    res.json({ message: await generateCommitMessage(diff) });
  } catch (error) { handleError(res, error); }
}

async function codeReview(req, res) {
  try {
    if (requireDatabase(res)) return;
    const repository = await getOwnedRepository(req.params.repoId, req.user.id);
    if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
    const branch = typeof req.body?.branch === "string" ? req.body.branch : "main";
    const commit = typeof req.body?.commit === "string" ? req.body.commit : null;
    const diff = await getRepositoryChangeDiff(repository, branch, commit);
    res.json(await reviewCode(diff));
  } catch (error) { handleError(res, error); }
}

async function issueAnalysis(req, res) {
  try {
    if (requireDatabase(res)) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.issueId)) return res.status(404).json({ error: "Issue not found or access denied." });
    const issue = await Issue.findById(req.params.issueId).populate("repository");
    if (!issue || String(issue.repository?.owner) !== req.user.id) return res.status(404).json({ error: "Issue not found or access denied." });
    res.json(await analyzeIssue(issue.toObject(), issue.repository));
  } catch (error) { handleError(res, error); }
}

async function assistantChat(req, res) {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ error: "A question is required." });
    if (prompt.length > 8000) return res.status(400).json({ error: "Questions must be 8,000 characters or fewer." });
    let context = "";
    if (req.body.repositoryId) {
      if (requireDatabase(res)) return;
      const repository = await getOwnedRepository(req.body.repositoryId, req.user.id);
      if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
      context = `Repository: ${repository.name}\nDescription: ${repository.description || ""}`;
    }
    res.json({ response: await chat(prompt, context, req.body?.history) });
  } catch (error) { handleError(res, error); }
}

module.exports = { commitMessage, codeReview, issueAnalysis, assistantChat, getBranchChanges };