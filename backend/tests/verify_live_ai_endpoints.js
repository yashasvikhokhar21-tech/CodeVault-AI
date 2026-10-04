const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const User = require("../models/userModel.js");
const Repository = require("../models/repoModel.js");
const Issue = require("../models/issueModel.js");
const PullRequest = require("../models/pullRequestModel.js");

function sanitize(value) {
  let text = String(value || "");
  for (const secret of [process.env.GEMINI_API_KEY, process.env.MONGODB_URI, process.env.JWT_SECRET]) {
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  }
  return text;
}

async function run() {
  let server;
  let repository;
  let issue;
  let pullRequest;
  let snapshotIds = [];
  let failed = false;

  try {
    if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("GEMINI_API_KEY is missing from backend/.env.");
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing from backend/.env.");
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

    const owner = await User.findOne().select("_id").lean();
    if (!owner) throw new Error("A temporary owned repository cannot be created because no user exists in MongoDB.");

    const fixtureFile = `ai-live-probe-${crypto.randomUUID().replace(/-/g, "")}.js`;
    const baseCommit = crypto.randomUUID();
    const sourceCommit = crypto.randomUUID();
    snapshotIds = [baseCommit, sourceCommit];
    const remoteRoot = path.resolve(process.cwd(), "remoteRepo");
    const baseRoot = path.join(remoteRoot, baseCommit);
    const sourceRoot = path.join(remoteRoot, sourceCommit);

    await fs.mkdir(baseRoot, { recursive: true });
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(path.join(baseRoot, fixtureFile), "module.exports = (left, right) => left + right;\n");
    await fs.writeFile(path.join(sourceRoot, fixtureFile), "module.exports = (left, right) => left - right;\n");
    await fs.writeFile(path.join(baseRoot, "commit.json"), JSON.stringify({ message: "base", date: new Date(Date.now() - 2000).toISOString() }));
    await fs.writeFile(path.join(sourceRoot, "commit.json"), JSON.stringify({ message: "change", date: new Date().toISOString() }));

    repository = await Repository.create({
      name: `ai-live-probe-${crypto.randomUUID()}`,
      description: "Temporary live AI endpoint verification fixture.",
      content: [fixtureFile],
      initialCommit: baseCommit,
      branches: [
        { name: "main", head: baseCommit, commits: [baseCommit] },
        { name: "ai-probe", head: sourceCommit, commits: [baseCommit, sourceCommit] },
      ],
      visibility: false,
      owner: owner._id,
      issues: [],
    });
    issue = await Issue.create({ title: "Addition result is incorrect", description: "The math helper returns an incorrect result.", repository: repository._id });
    pullRequest = await PullRequest.create({
      repository: repository._id,
      number: 1,
      title: "Update math helper",
      description: "Change the arithmetic implementation.",
      author: owner._id,
      sourceBranch: "ai-probe",
      targetBranch: "main",
      status: "OPEN",
    });

    const app = express();
    app.use(express.json());
    app.use(cors({ origin: "*" }));
    app.use("/", require("../routes/main.routers.js"));
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });

    const token = jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const repoId = String(repository._id);
    const requests = [
      ["AI Assistant", "/ai/chat", { prompt: "Summarize the temporary repository change.", repositoryId: repoId, history: [] }, (body) => typeof body.response === "string" && body.response.trim()],
      ["AI Commit Message Generator", `/ai/repositories/${repoId}/commit-message`, { branch: "ai-probe" }, (body) => typeof body.message === "string" && body.message.trim()],
      ["AI Code Review / Review Changes", `/ai/repositories/${repoId}/review`, { branch: "ai-probe" }, (body) => Array.isArray(body.findings)],
      ["Issue Analysis", `/ai/issues/${issue._id}/analyze`, {}, (body) => ["summary", "likelyCause", "suggestedApproach", "priority", "affectedArea", "suggestedFix", "potentialRisks", "testingSuggestions"].every((key) => typeof body[key] === "string")],
      ["PR AI Review", `/repo/${repoId}/pulls/${pullRequest._id}/ai-review`, {}, (body) => typeof body.summary === "string" && Array.isArray(body.findings)],
    ];

    for (const [name, endpoint, body, isValid] of requests) {
      try {
        const response = await fetch(baseUrl + endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45000),
        });
        const result = await response.json().catch(() => ({}));
        const passed = response.ok && isValid(result);
        console.log(`${name}: HTTP ${response.status} ${passed ? "PASS (valid response shape)" : `FAIL ${sanitize(JSON.stringify({ code: result.code, error: result.error }))}`}`);
        if (!passed) failed = true;
      } catch (error) {
        console.log(`${name}: NETWORK ${sanitize(error.name)} ${sanitize(error.message)}`);
        failed = true;
      }
    }
  } catch (error) {
    console.log(`Live endpoint harness setup failed: ${sanitize(error.name)} ${sanitize(error.message)}`);
    failed = true;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pullRequest) await PullRequest.deleteOne({ _id: pullRequest._id }).catch(() => {});
    if (issue) await Issue.deleteOne({ _id: issue._id }).catch(() => {});
    if (repository) await Repository.deleteOne({ _id: repository._id }).catch(() => {});
    for (const id of snapshotIds) await fs.rm(path.resolve(process.cwd(), "remoteRepo", id), { recursive: true, force: true }).catch(() => {});
    if (mongoose.connection.readyState) await mongoose.disconnect().catch(() => {});
    console.log("Temporary AI fixture cleanup completed.");
  }

  if (failed) process.exitCode = 1;
}

run();