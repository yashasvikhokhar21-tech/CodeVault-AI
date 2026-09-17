const fs = require("fs").promises;
const path = require("path");
const mongoose = require("mongoose");
const Repository = require("../models/repoModel.js");
const Issue = require("../models/issueModel.js");
const { generateCommitMessage, reviewCode, analyzeIssue, chat, AIError, limitContext } = require("../services/aiService.js");

function handleError(res, error) {
  if (error instanceof AIError) return res.status(error.status).json({ error: error.message });
  console.error("AI request failed:", error.message);
  return res.status(500).json({ error: "The AI request could not be completed." });
}

async function getOwnedRepository(repoId, userId) {
  if (!mongoose.Types.ObjectId.isValid(repoId)) return null;
  return Repository.findOne({ _id: repoId, owner: userId }).populate("issues");
}

async function getStagedContext(repository) {
  const stagingPath = path.resolve(process.cwd(), ".hiddenGit", "staging");
  let files = [];
  try { files = await fs.readdir(stagingPath); } catch { /* The repository may not have staged files yet. */ }
  const staged = [];
  for (const file of files.slice(0, 80)) {
    try {
      const content = await fs.readFile(path.join(stagingPath, file), "utf8");
      staged.push(`--- ${file} ---\n${content}`);
    } catch { /* Skip unreadable staged files. */ }
  }
  return limitContext(`Repository: ${repository.name}\nDescription: ${repository.description || ""}\n\n${staged.join("\n\n") || "No staged files were found. The repository has no available staged diff."}`);
}

async function commitMessage(req, res) {
  try {
    const repository = await getOwnedRepository(req.params.repoId, req.user.id);
    if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
    res.json({ message: await generateCommitMessage(await getStagedContext(repository)) });
  } catch (error) { handleError(res, error); }
}

async function codeReview(req, res) {
  try {
    const repository = await getOwnedRepository(req.params.repoId, req.user.id);
    if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
    res.json(await reviewCode(await getStagedContext(repository)));
  } catch (error) { handleError(res, error); }
}

async function issueAnalysis(req, res) {
  try {
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
    let context = "";
    if (req.body.repositoryId) {
      const repository = await getOwnedRepository(req.body.repositoryId, req.user.id);
      if (!repository) return res.status(404).json({ error: "Repository not found or access denied." });
      context = `Repository: ${repository.name}\nDescription: ${repository.description || ""}`;
    }
    res.json({ response: await chat(prompt, context) });
  } catch (error) { handleError(res, error); }
}

module.exports = { commitMessage, codeReview, issueAnalysis, assistantChat };