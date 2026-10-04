const mongoose = require("mongoose");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { ZipArchive } = require("archiver");
const { v4: uuidv4 } = require("uuid");
const Repository = require("../models/repoModel.js");
const User = require("../models/userModel.js");
const Issue = require("../models/issueModel.js");
const PullRequest = require("../models/pullRequestModel.js");
const { reviewPullRequestDiff, redactSecrets, AIError } = require("../services/aiService.js");
const execFileAsync = promisify(execFile);

const commandEntry = path.resolve(__dirname, "../index.js");
const MAX_IMPORT_FILES = 10000;
const MAX_IMPORT_TOTAL_BYTES = 250 * 1024 * 1024;
const isValidObjectId = (value) => typeof value === "string" && mongoose.Types.ObjectId.isValid(value);
const excludedDirectories = new Map([
  ["node_modules", "dependency folder"],
  [".git", "Git metadata"],
  ["dist", "generated build output"],
  ["build", "generated build output"],
  ["coverage", "test coverage output"],
  [".next", "Next.js generated output"],
  [".vite", "Vite generated output"],
  [".cache", "cache folder"],
  [".parcel-cache", "Parcel cache"],
  [".turbo", "Turbo cache"],
  [".vercel", "Vercel generated output"],
  ["__pycache__", "Python cache"],
  [".pytest_cache", "pytest cache"],
  [".mypy_cache", "mypy cache"],
  ["target", "generated build output"],
]);
const sensitiveFile = (filePath) => path.basename(filePath).toLowerCase() === ".env" || path.basename(filePath).toLowerCase().startsWith(".env.");

function getImportExclusion(relativePath) {
  const parts = relativePath.split("/");
  const excludedDirectory = parts.find((part) => excludedDirectories.has(part.toLowerCase()));
  if (excludedDirectory) return excludedDirectories.get(excludedDirectory.toLowerCase());
  if (sensitiveFile(relativePath)) return "environment secret file";
  return null;
}

async function runImportCommand(command, args, cwd) {
  await execFileAsync(process.execPath, [commandEntry, command, ...args], { cwd, windowsHide: true });
}

function safeImportPath(originalName, root) {
  const relativePath = String(originalName || "").replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("/") || path.posix.isAbsolute(relativePath)) throw new Error("Unsafe uploaded path.");
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe uploaded path.");
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe uploaded path.");
  return { relativePath: parts.join("/"), target };
}

async function importRepository(req, res) {
  const { name, description, visibility } = req.body;
  const trimmedName = typeof name === "string" ? name.normalize("NFKC").trim().replace(/\s+/g, "-") : name;
  if (!trimmedName || !/^[\p{L}\p{N}._-]+$/u.test(trimmedName)) return res.status(400).json({ error: "A valid repository name is required." });
  if (!req.files?.length) return res.status(400).json({ error: "Select at least one project file." });
  let relativePaths;
  try { relativePaths = JSON.parse(req.body.paths || "[]"); } catch { return res.status(400).json({ error: "Invalid project file paths." }); }
  if (!Array.isArray(relativePaths) || relativePaths.length !== req.files.length) return res.status(400).json({ error: "Project file paths are missing." });
  if (await Repository.exists({ name: trimmedName })) return res.status(409).json({ error: "A repository with this name already exists." });

  const importRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codevault-import-"));
  const importedPaths = [];
  const importedPathSet = new Set();
  let totalBytes = 0;
  let pushedCommitId;
  try {
    for (const [index, file] of req.files.entries()) {
      const safePath = safeImportPath(relativePaths[index], importRoot);
      if (getImportExclusion(safePath.relativePath)) continue;
      if (importedPathSet.has(safePath.relativePath)) throw new Error("Duplicate project file path.");
      if (importedPaths.length >= MAX_IMPORT_FILES) throw new Error("The project contains more than 10,000 files after exclusions.");
      totalBytes += file.size;
      if (totalBytes > MAX_IMPORT_TOTAL_BYTES) throw new Error("The project exceeds the 250 MiB total size limit after exclusions.");
      await fs.mkdir(path.dirname(safePath.target), { recursive: true });
      await fs.writeFile(safePath.target, file.buffer, { flag: "wx" });
      importedPaths.push(safePath.relativePath);
      importedPathSet.add(safePath.relativePath);
    }
    if (!importedPaths.length) return res.status(400).json({ error: "No safe project files were selected." });

    await runImportCommand("init", [], importRoot);
    for (const relativePath of importedPaths) await runImportCommand("add", [path.join(importRoot, ...relativePath.split("/"))], importRoot);
    await runImportCommand("commits", ["Import existing project"], importRoot);
    await runImportCommand("push", [], importRoot);

    const commitIds = await fs.readdir(path.join(importRoot, ".hiddenGit", "commits"));
    const commitId = commitIds[0];
    pushedCommitId = commitId;
    const remoteCommitRoot = path.resolve(process.cwd(), "remoteRepo", commitId);
    for (const relativePath of importedPaths) {
      const source = path.join(importRoot, ...relativePath.split("/"));
      const destination = path.join(remoteCommitRoot, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    await fs.copyFile(
      path.join(importRoot, ".hiddenGit", "commits", commitId, "commit.json"),
      path.join(remoteCommitRoot, "commit.json")
    );

    const repository = await new Repository({ name: trimmedName, description, visibility: visibility === "false" ? false : true, owner: req.user.id, content: importedPaths, initialCommit: commitId, issues: [] }).save();
    return res.status(201).json({ message: "Project imported!", repositoryID: repository._id });
  } catch (err) {
    console.error("Error importing repository:", err.message);
    if (pushedCommitId) await fs.rm(path.resolve(process.cwd(), "remoteRepo", pushedCommitId), { recursive: true, force: true });
    return res.status(400).json({ error: err.message || "Could not import project." });
  } finally {
    await fs.rm(importRoot, { recursive: true, force: true });
  }
}

async function fetchRepositoryFiles(req, res) {
  try {
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found!" });
    const expectedPaths = repository.content || [];
    const snapshots = await repositorySnapshots(repository, req.query.branch || "main");
    const selectedSnapshot = snapshots.at(-1);
    if (selectedSnapshot) {
      const branchFiles = [...selectedSnapshot.files.keys()];
      return res.json({
        files: await Promise.all(branchFiles.map(async (relativePath) => ({ path: relativePath, content: await fs.readFile(path.join(selectedSnapshot.root, ...relativePath.split("/")), "utf8") }))),
        commits: snapshots.length ? [{ id: selectedSnapshot.id, message: selectedSnapshot.message, date: selectedSnapshot.date }] : [],
      });
    }
    if (req.query.branch) return res.json({ files: [], commits: [] });
    const remotePath = path.resolve(process.cwd(), "remoteRepo");
    const commits = (await fs.readdir(remotePath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name));
    if (repository.initialCommit) {
      commits.sort((left, right) => (left.name === repository.initialCommit ? -1 : right.name === repository.initialCommit ? 1 : 0));
    }
    for (const commit of commits) {
      const commitRoot = path.join(remotePath, commit.name);
      const matches = [];
      for (const relativePath of expectedPaths) {
        const target = path.resolve(commitRoot, ...relativePath.split("/"));
        if (target.startsWith(`${commitRoot}${path.sep}`) && await fs.stat(target).then((stats) => stats.isFile()).catch(() => false)) {
          matches.push(relativePath);
        }
      }
      if (matches.length === expectedPaths.length && matches.length) {
        const files = await Promise.all(matches.map(async (relativePath) => ({ path: relativePath, content: await fs.readFile(path.join(commitRoot, ...relativePath.split("/")), "utf8") })));
        const commitInfo = await fs.readFile(path.join(commitRoot, "commit.json"), "utf8").then(JSON.parse).catch(() => null);
        return res.json({ files, commits: commitInfo ? [{ id: commit.name, ...commitInfo }] : [] });
      }
    }
    return res.json({ files: [], commits: [] });
  } catch (err) {
    console.error("Error during fetching repository files:", err.message);
    return res.status(500).json({ error: "Could not load repository files." });
  }
}

async function downloadRepository(req, res) {
  try {
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!repository.visibility && String(repository.owner) !== req.user.id) return res.status(403).json({ error: "You are not authorized to download this repository." });
    if (!repository.initialCommit || !repository.content?.length) return res.status(404).json({ error: "This repository has no downloadable files." });

    const commitRoot = path.resolve(process.cwd(), "remoteRepo", repository.initialCommit);
    const files = [];
    for (const relativePath of repository.content) {
      if (getImportExclusion(relativePath)) continue;
      const parts = relativePath.split("/");
      const filePath = path.resolve(commitRoot, ...parts);
      if (!filePath.startsWith(`${commitRoot}${path.sep}`)) return res.status(400).json({ error: "Invalid repository file path." });
      if (await fs.stat(filePath).then((stats) => stats.isFile()).catch(() => false)) files.push({ filePath, relativePath });
    }
    if (!files.length) return res.status(404).json({ error: "This repository has no downloadable files." });

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error) => {
      console.error("Repository ZIP failed:", error.message);
      if (!res.headersSent) res.status(500).json({ error: "Could not create repository ZIP." });
      else res.destroy(error);
    });
    res.attachment(`${repository.name}.zip`);
    archive.pipe(res);
    files.forEach(({ filePath, relativePath }) => archive.file(filePath, { name: relativePath }));
    await archive.finalize();
  } catch (err) {
    console.error("Error during repository download:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Could not download repository." });
  }
}

function validCommitId(commitId) {
  return typeof commitId === "string" && /^[A-Za-z0-9_-]+$/.test(commitId);
}

function validBranchName(branchName) {
  return typeof branchName === "string" && /^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(branchName);
}

async function repositoryAccess(req, repository) {
  return Boolean(repository.visibility) || String(repository.owner) === req.user.id;
}

async function readSnapshot(snapshotRoot) {
  const files = new Map();
  async function walk(current, prefix = "") {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name === "commit.json") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target, relativePath);
      else if (entry.isFile()) files.set(relativePath, await fs.readFile(target));
    }
  }
  await walk(snapshotRoot);
  return files;
}

async function allRepositorySnapshots(repository) {
  const remotePath = path.resolve(process.cwd(), "remoteRepo");
  const entries = await fs.readdir(remotePath, { withFileTypes: true }).catch(() => []);
  const snapshots = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    if (!validCommitId(entry.name)) continue;
    const root = path.join(remotePath, entry.name);
    const info = await fs.readFile(path.join(root, "commit.json"), "utf8").then(JSON.parse).catch(() => null);
    const files = await readSnapshot(root).catch(() => new Map());
    const related = entry.name === repository.initialCommit || [...files.keys()].some((filePath) => repository.content?.includes(filePath));
    if (related && info) snapshots.push({ id: entry.name, root, files, message: info.message, date: info.date });
  }
  return snapshots.sort((left, right) => new Date(left.date) - new Date(right.date));
}

async function ensureBranches(repository) {
  const snapshots = await allRepositorySnapshots(repository);
  if (!repository.branches?.length) {
    repository.branches = [{ name: "main", head: repository.initialCommit || snapshots.at(-1)?.id || null, commits: snapshots.map((snapshot) => snapshot.id) }];
    await repository.save();
  }
  return repository.branches;
}

async function repositorySnapshots(repository, branchName) {
  const snapshots = await allRepositorySnapshots(repository);
  if (!branchName) return snapshots;
  const branches = await ensureBranches(repository);
  const branch = branches.find((item) => item.name === branchName);
  if (!branch) return [];
  const commits = new Set(branch.commits || (branch.head ? [branch.head] : []));
  return snapshots.filter((snapshot) => commits.has(snapshot.id));
}

function snapshotDiff(parent, current) {
  const paths = [...new Set([...parent.keys(), ...current.keys()])].sort();
  return paths.map((filePath) => {
    const oldBuffer = parent.get(filePath);
    const newBuffer = current.get(filePath);
    if (!oldBuffer) return { path: filePath, status: "Added" };
    if (!newBuffer) return { path: filePath, status: "Deleted" };
    return { path: filePath, status: oldBuffer.equals(newBuffer) ? "Unchanged" : "Modified" };
  }).filter((file) => file.status !== "Unchanged");
}

function lineDiff(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  if (oldLines.at(-1) === "") oldLines.pop();
  if (newLines.at(-1) === "") newLines.pop();
  const rows = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    if (oldLines[index] === newLines[index]) rows.push({ type: "context", text: oldLines[index] ?? "" });
    else {
      if (oldLines[index] !== undefined) rows.push({ type: "deleted", text: oldLines[index] });
      if (newLines[index] !== undefined) rows.push({ type: "added", text: newLines[index] });
    }
  }
  return rows;
}

async function listRepositoryCommits(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Repository not found." });
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view this repository." });
    const snapshots = await repositorySnapshots(repository, req.query.branch || "main");
    res.json(snapshots.map((snapshot, index) => ({ id: snapshot.id, message: snapshot.message, date: snapshot.date, author: null, changedFiles: snapshotDiff(index ? snapshots[index - 1].files : new Map(), snapshot.files).length })));
  } catch (err) { console.error("Error during commit history:", err.message); res.status(500).json({ error: "Could not load commit history." }); }
}

async function getRepositoryCommit(req, res) {
  try {
    if (!validCommitId(req.params.commitId) || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Commit not found." });
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view this repository." });
    const snapshots = await repositorySnapshots(repository, req.query.branch || "main");
    const index = snapshots.findIndex((snapshot) => snapshot.id === req.params.commitId);
    if (index < 0) return res.status(404).json({ error: "Commit not found." });
    const files = snapshotDiff(index ? snapshots[index - 1].files : new Map(), snapshots[index].files);
    res.json({ id: snapshots[index].id, message: snapshots[index].message, date: snapshots[index].date, author: null, files });
  } catch (err) { console.error("Error during commit details:", err.message); res.status(500).json({ error: "Could not load commit details." }); }
}

async function getRepositoryDiff(req, res) {
  try {
    const { id, commitId } = req.params;
    const relativePath = String(req.query.path || "").replace(/\\/g, "/");
    if (!validCommitId(commitId) || !relativePath || relativePath.startsWith("/") || relativePath.split("/").some((part) => part === "..")) return res.status(400).json({ error: "Invalid commit or file path." });
    const repository = await Repository.findById(id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view this repository." });
    const snapshots = await repositorySnapshots(repository, req.query.branch || "main");
    const index = snapshots.findIndex((snapshot) => snapshot.id === commitId);
    if (index < 0) return res.status(404).json({ error: "Commit not found." });
    const current = snapshots[index].files.get(relativePath);
    const parent = index ? snapshots[index - 1].files.get(relativePath) : undefined;
    if (!current && !parent) return res.status(404).json({ error: "Changed file not found." });
    const isBinary = (buffer) => buffer && buffer.includes(0);
    if (isBinary(current) || isBinary(parent)) return res.json({ path: relativePath, binary: true, lines: [] });
    res.json({ path: relativePath, binary: false, lines: lineDiff(parent ? parent.toString("utf8") : "", current ? current.toString("utf8") : "") });
  } catch (err) { console.error("Error during commit diff:", err.message); res.status(500).json({ error: "Could not load commit diff." }); }
}

async function listBranches(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Repository not found." });
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view branches." });
    const branches = await ensureBranches(repository);
    res.json(branches.map((branch) => ({ name: branch.name, head: branch.head, commits: (branch.commits || []).length })));
  } catch (err) { console.error("Error during branch listing:", err.message); res.status(500).json({ error: "Could not load branches." }); }
}

async function createBranch(req, res) {
  try {
    const { id, branchName } = req.params;
    const source = req.body?.from || "main";
    if (!mongoose.Types.ObjectId.isValid(id) || !validBranchName(branchName) || branchName === "main") return res.status(400).json({ error: "Invalid branch name." });
    const repository = await Repository.findById(id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (String(repository.owner) !== req.user.id) return res.status(403).json({ error: "Only the repository owner can create branches." });
    const branches = await ensureBranches(repository);
    if (!validBranchName(source)) return res.status(400).json({ error: "Invalid source branch." });
    if (branches.some((branch) => branch.name === branchName)) return res.status(409).json({ error: "Branch already exists." });
    const sourceBranch = branches.find((branch) => branch.name === source);
    if (!sourceBranch) return res.status(404).json({ error: "Source branch not found." });
    repository.branches.push({ name: branchName, head: sourceBranch.head, commits: [...(sourceBranch.commits || [])] });
    await repository.save();
    res.status(201).json({ name: branchName, head: sourceBranch.head, commits: (sourceBranch.commits || []).length });
  } catch (err) { console.error("Error during branch creation:", err.message); res.status(500).json({ error: "Could not create branch." }); }
}

async function deleteBranch(req, res) {
  try {
    const { id, branchName } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !validBranchName(branchName)) return res.status(400).json({ error: "Invalid branch name." });
    const repository = await Repository.findById(id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (String(repository.owner) !== req.user.id) return res.status(403).json({ error: "Only the repository owner can delete branches." });
    if (branchName === "main") return res.status(400).json({ error: "The main branch cannot be deleted." });
    if (req.body?.currentBranch === branchName) return res.status(400).json({ error: "The current branch cannot be deleted." });
    await ensureBranches(repository);
    const branch = repository.branches.find((item) => item.name === branchName);
    if (!branch) return res.status(404).json({ error: "Branch not found." });
    repository.branches = repository.branches.filter((item) => item.name !== branchName);
    await repository.save();
    res.json({ message: "Branch deleted." });
  } catch (err) { console.error("Error during branch deletion:", err.message); res.status(500).json({ error: "Could not delete branch." }); }
}

function bufferEqual(left, right) {
  if (!left || !right) return !left && !right;
  return left.equals(right);
}

async function pullRequestContext(repository, sourceBranch, targetBranch) {
  const branches = await ensureBranches(repository);
  const source = branches.find((branch) => branch.name === sourceBranch);
  const target = branches.find((branch) => branch.name === targetBranch);
  if (!source || !target) return null;
  const snapshots = await allRepositorySnapshots(repository);
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const sourceIds = source.commits || [];
  const targetIds = target.commits || [];
  const commonId = [...targetIds].reverse().find((id) => sourceIds.includes(id));
  return { branches, source, target, byId, commonId, base: commonId ? byId.get(commonId)?.files || new Map() : new Map(), sourceSnapshot: source.head ? byId.get(source.head) : null, targetSnapshot: target.head ? byId.get(target.head) : null };
}

function compareSnapshots(base, target, source) {
  const paths = [...new Set([...base.keys(), ...target.keys(), ...source.keys()])].sort();
  const conflicts = [];
  const files = [];
  for (const filePath of paths) {
    const baseFile = base.get(filePath);
    const targetFile = target.get(filePath);
    const sourceFile = source.get(filePath);
    const targetChanged = !bufferEqual(baseFile, targetFile);
    const sourceChanged = !bufferEqual(baseFile, sourceFile);
    if (targetChanged && sourceChanged && !bufferEqual(targetFile, sourceFile)) conflicts.push(filePath);
    if (!bufferEqual(targetFile, sourceFile)) files.push({ path: filePath, status: !targetFile ? "Added" : !sourceFile ? "Deleted" : "Modified" });
  }
  return { conflicts, files };
}

function pullRequestResponse(pullRequest) {
  return {
    id: pullRequest._id,
    number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.description,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    status: pullRequest.status,
    author: pullRequest.author,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    mergedAt: pullRequest.mergedAt,
    mergedBy: pullRequest.mergedBy,
    mergeCommit: pullRequest.mergeCommit,
    comments: pullRequest.comments,
  };
}

async function listPullRequests(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Repository not found." });
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view pull requests." });
    const pullRequests = await PullRequest.find({ repository: repository._id }).sort({ number: -1 }).populate("author", "username fullName");
    res.json(pullRequests.map(pullRequestResponse));
  } catch (err) { console.error("Error during pull request listing:", err.message); res.status(500).json({ error: "Could not load pull requests." }); }
}

async function createPullRequest(req, res) {
  try {
    const { sourceBranch, targetBranch } = req.body || {};
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Repository not found." });
    if (!validBranchName(sourceBranch) || !validBranchName(targetBranch) || sourceBranch === targetBranch) return res.status(400).json({ error: "Valid, different source and target branches are required." });
    if (!title || title.length > 200) return res.status(400).json({ error: "A pull request title is required and must be 200 characters or fewer." });
    if (description.length > 5000) return res.status(400).json({ error: "Description must be 5,000 characters or fewer." });
    const repository = await Repository.findById(req.params.id);
    if (!repository) return res.status(404).json({ error: "Repository not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to create pull requests." });
    const context = await pullRequestContext(repository, sourceBranch, targetBranch);
    if (!context) return res.status(404).json({ error: "Source or target branch not found." });
    const duplicate = await PullRequest.exists({ repository: repository._id, sourceBranch, targetBranch, status: "OPEN" });
    if (duplicate) return res.status(409).json({ error: "An open pull request already exists for these branches." });
    const latest = await PullRequest.findOne({ repository: repository._id }).sort({ number: -1 });
    const pullRequest = await new PullRequest({ repository: repository._id, number: (latest?.number || 0) + 1, title, description, author: req.user.id, sourceBranch, targetBranch }).save();
    res.status(201).json(pullRequestResponse(await pullRequest.populate("author", "username fullName")));
  } catch (err) { console.error("Error during pull request creation:", err.message); res.status(500).json({ error: "Could not create pull request." }); }
}

async function getPullRequest(req, res) {
  try {
    const repository = await Repository.findById(req.params.id);
    const pullRequest = await PullRequest.findOne({ _id: req.params.pullId, repository: req.params.id }).populate("author mergedBy comments.author", "username fullName");
    if (!repository || !pullRequest) return res.status(404).json({ error: "Pull request not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view this pull request." });
    const context = await pullRequestContext(repository, pullRequest.sourceBranch, pullRequest.targetBranch);
    if (!context) return res.status(409).json({ error: "A pull request branch no longer exists." });
    const comparison = compareSnapshots(context.base, context.targetSnapshot?.files || new Map(), context.sourceSnapshot?.files || new Map());
    res.json({ ...pullRequestResponse(pullRequest), commits: context.source.commits.slice(context.commonId ? context.source.commits.indexOf(context.commonId) + 1 : 0), files: comparison.files, conflicts: comparison.conflicts });
  } catch (err) { console.error("Error during pull request details:", err.message); res.status(500).json({ error: "Could not load pull request." }); }
}

async function addPullRequestComment(req, res) {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 5000) return res.status(400).json({ error: "Comment text is required and must be 5,000 characters or fewer." });
    const repository = await Repository.findById(req.params.id);
    const pullRequest = await PullRequest.findOne({ _id: req.params.pullId, repository: req.params.id });
    if (!repository || !pullRequest) return res.status(404).json({ error: "Pull request not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to comment on this pull request." });
    pullRequest.comments.push({ author: req.user.id, text }); pullRequest.updatedAt = new Date(); await pullRequest.save();
    const populated = await pullRequest.populate("comments.author", "username fullName");
    res.status(201).json(populated.comments.at(-1));
  } catch (err) { console.error("Error during pull request comment:", err.message); res.status(500).json({ error: "Could not add comment." }); }
}

async function getPullRequestDiff(req, res) {
  try {
    const relativePath = String(req.query.path || "").replace(/\\/g, "/");
    if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").some((part) => part === "..")) return res.status(400).json({ error: "Invalid file path." });
    const repository = await Repository.findById(req.params.id);
    const pullRequest = await PullRequest.findOne({ _id: req.params.pullId, repository: req.params.id });
    if (!repository || !pullRequest) return res.status(404).json({ error: "Pull request not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view this pull request." });
    const context = await pullRequestContext(repository, pullRequest.sourceBranch, pullRequest.targetBranch);
    if (!context) return res.status(409).json({ error: "A pull request branch no longer exists." });
    const current = context.sourceSnapshot?.files.get(relativePath);
    const parent = context.targetSnapshot?.files.get(relativePath);
    if (!current && !parent) return res.status(404).json({ error: "Changed file not found." });
    if ((current && current.includes(0)) || (parent && parent.includes(0))) return res.json({ path: relativePath, binary: true, lines: [] });
    res.json({ path: relativePath, binary: false, lines: lineDiff(parent ? parent.toString("utf8") : "", current ? current.toString("utf8") : "") });
  } catch (err) { console.error("Error during pull request diff:", err.message); res.status(500).json({ error: "Could not load pull request diff." }); }
}

function isSensitivePath(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12") || base.endsWith(".pfx")) return true;
  if (base === "id_rsa" || base === "id_ed25519" || base === "id_ecdsa") return true;
  return false;
}

const MAX_PR_DIFF_CHARS = 24000;

async function getRepositoryChangeDiff(repository, branchName) {
  const snapshots = await repositorySnapshots(repository, branchName);
  if (!snapshots.length) throw new AIError("No committed changes were found on this branch to review.", 400);

  const currentSnapshot = snapshots.at(-1);
  const previousFiles = snapshots.at(-2)?.files || new Map();
  const changedFiles = snapshotDiff(previousFiles, currentSnapshot.files);
  if (!changedFiles.length) throw new AIError("No changed files were found on this branch to review.", 400);

  const chunks = changedFiles.map((file) => {
    if (isSensitivePath(file.path)) {
      return `--- a/${file.path}\n+++ b/${file.path} (${file.status})\n[File omitted: sensitive configuration file]`;
    }

    const current = currentSnapshot.files.get(file.path);
    const previous = previousFiles.get(file.path);
    if ((current && current.includes(0)) || (previous && previous.includes(0))) {
      return `--- a/${file.path}\n+++ b/${file.path} (${file.status})\n[Binary file: diff omitted]`;
    }

    const rows = lineDiff(previous ? previous.toString("utf8") : "", current ? current.toString("utf8") : "");
    let previousLine = 0;
    let currentLine = 0;
    const lines = rows.map((row) => {
      if (row.type === "context") {
        previousLine += 1;
        currentLine += 1;
        return `  L${currentLine}: ${row.text}`;
      }
      if (row.type === "added") {
        currentLine += 1;
        return `+ L${currentLine}: ${row.text}`;
      }
      previousLine += 1;
      return `- L${previousLine} (old): ${row.text}`;
    });
    return `--- a/${file.path}\n+++ b/${file.path} (${file.status})\n${lines.join("\n")}`;
  });

  const diff = redactSecrets(chunks.join("\n\n"));
  if (diff.length > MAX_PR_DIFF_CHARS) {
    throw new AIError("The repository changes are too large for AI review. Please review a smaller commit.", 400);
  }
  return diff;
}

async function reviewPullRequest(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.pullId)) {
      return res.status(404).json({ error: "Repository or pull request not found." });
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Repository storage is temporarily unavailable. Please retry shortly.", code: "DATABASE_UNAVAILABLE" });
    }
    const repository = await Repository.findById(req.params.id);
    const pullRequest = await PullRequest.findOne({ _id: req.params.pullId, repository: req.params.id });
    if (!repository || !pullRequest) return res.status(404).json({ error: "Pull request not found." });
    if (!await repositoryAccess(req, repository)) return res.status(403).json({ error: "You are not authorized to view this pull request." });

    const context = await pullRequestContext(repository, pullRequest.sourceBranch, pullRequest.targetBranch);
    if (!context) return res.status(409).json({ error: "A pull request branch no longer exists." });

    const comparison = compareSnapshots(context.base, context.targetSnapshot?.files || new Map(), context.sourceSnapshot?.files || new Map());
    if (!comparison.files.length) {
      return res.status(400).json({ error: "No changed files found in this pull request to review." });
    }

    const diffChunks = [];
    for (const file of comparison.files) {
      if (isSensitivePath(file.path)) {
        diffChunks.push(`--- a/${file.path}\n+++ b/${file.path} (${file.status})\n[File omitted: sensitive configuration file]`);
        continue;
      }
      const current = context.sourceSnapshot?.files.get(file.path);
      const parent = context.targetSnapshot?.files.get(file.path);
      const isBinary = (buffer) => buffer && buffer.includes(0);
      if (isBinary(current) || isBinary(parent)) {
        diffChunks.push(`--- a/${file.path}\n+++ b/${file.path} (${file.status})\n[Binary file: diff omitted]`);
        continue;
      }

      const rows = lineDiff(parent ? parent.toString("utf8") : "", current ? current.toString("utf8") : "");
      let parentLine = 0;
      let currentLine = 0;
      const formattedLines = [];
      for (const row of rows) {
        if (row.type === "context") {
          parentLine += 1;
          currentLine += 1;
          formattedLines.push(`  L${currentLine}: ${row.text}`);
        } else if (row.type === "added") {
          currentLine += 1;
          formattedLines.push(`+ L${currentLine}: ${row.text}`);
        } else if (row.type === "deleted") {
          parentLine += 1;
          formattedLines.push(`- L${parentLine} (old): ${row.text}`);
        }
      }
      diffChunks.push(`--- a/${file.path}\n+++ b/${file.path} (${file.status})\n${formattedLines.join("\n")}`);
    }

    const combinedDiff = diffChunks.join("\n\n");
    const sanitizedDiff = redactSecrets(combinedDiff);

    if (!sanitizedDiff.trim()) {
      return res.status(400).json({ error: "No changed code found in this pull request to review." });
    }

    if (sanitizedDiff.length > MAX_PR_DIFF_CHARS) {
      return res.status(400).json({
        error: "The pull request diff is too large for AI review. Please review changes in smaller pull requests.",
      });
    }

    const review = await reviewPullRequestDiff({
      title: pullRequest.title,
      description: pullRequest.description,
      sourceBranch: pullRequest.sourceBranch,
      targetBranch: pullRequest.targetBranch,
      diff: sanitizedDiff,
    });

    res.json(review);
  } catch (err) {
    if (err instanceof AIError) {
      return res.status(err.status).json({ error: err.message, code: err.code, retryAfterMs: err.retryAfterMs, ...(err.quota ? { quota: err.quota } : {}) });
    }
    console.error("Error during pull request AI review:", err.name || "Error", err.status || "unknown status");
    res.status(500).json({ error: "Could not generate AI code review." });
  }
}

async function closePullRequest(req, res) {
  try {
    const repository = await Repository.findById(req.params.id);
    const pullRequest = await PullRequest.findOne({ _id: req.params.pullId, repository: req.params.id });
    if (!repository || !pullRequest) return res.status(404).json({ error: "Pull request not found." });
    if (String(repository.owner) !== req.user.id) return res.status(403).json({ error: "Only the repository owner can close pull requests." });
    if (pullRequest.status !== "OPEN") return res.status(400).json({ error: "Only open pull requests can be closed." });
    pullRequest.status = "CLOSED"; pullRequest.updatedAt = new Date(); await pullRequest.save(); res.json(pullRequestResponse(pullRequest));
  } catch (err) { console.error("Error closing pull request:", err.message); res.status(500).json({ error: "Could not close pull request." }); }
}

async function mergePullRequest(req, res) {
  try {
    const repository = await Repository.findById(req.params.id);
    const pullRequest = await PullRequest.findOne({ _id: req.params.pullId, repository: req.params.id });
    if (!repository || !pullRequest) return res.status(404).json({ error: "Pull request not found." });
    if (String(repository.owner) !== req.user.id) return res.status(403).json({ error: "Only the repository owner can merge pull requests." });
    if (pullRequest.status !== "OPEN") return res.status(400).json({ error: "Only open pull requests can be merged." });
    const context = await pullRequestContext(repository, pullRequest.sourceBranch, pullRequest.targetBranch);
    if (!context) return res.status(409).json({ error: "A pull request branch no longer exists." });
    const comparison = compareSnapshots(context.base, context.targetSnapshot?.files || new Map(), context.sourceSnapshot?.files || new Map());
    if (comparison.conflicts.length) return res.status(409).json({ error: "Conflicts detected.", conflicts: comparison.conflicts });
    const merged = new Map(context.targetSnapshot?.files || new Map());
    const allPaths = new Set([...context.base.keys(), ...(context.sourceSnapshot?.files || new Map()).keys()]);
    for (const filePath of allPaths) {
      const baseFile = context.base.get(filePath); const sourceFile = context.sourceSnapshot?.files.get(filePath);
      if (!bufferEqual(baseFile, sourceFile)) { if (sourceFile) merged.set(filePath, sourceFile); else merged.delete(filePath); }
    }
    const mergeCommit = uuidv4();
    const mergeRoot = path.resolve(process.cwd(), "remoteRepo", mergeCommit);
    for (const [relativePath, content] of merged) { const target = path.join(mergeRoot, ...relativePath.split("/")); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
    await fs.writeFile(path.join(mergeRoot, "commit.json"), JSON.stringify({ message: `Merge #${pullRequest.number}: ${pullRequest.title}`, date: new Date().toISOString() }));
    const targetBranch = context.target;
    targetBranch.commits = [...(targetBranch.commits || []), mergeCommit]; targetBranch.head = mergeCommit;
    repository.content = [...new Set([...repository.content, ...merged.keys()])]; await repository.save();
    pullRequest.status = "MERGED"; pullRequest.mergedAt = new Date(); pullRequest.mergedBy = req.user.id; pullRequest.mergeCommit = mergeCommit; pullRequest.updatedAt = new Date(); await pullRequest.save();
    res.json({ ...pullRequestResponse(pullRequest), conflicts: [] });
  } catch (err) { console.error("Error merging pull request:", err.message); res.status(500).json({ error: "Could not merge pull request." }); }
}



async function createRepository(req, res) {
  const { owner, name, issues, content, description, visibility } = req.body;

  try {
    const trimmedName = typeof name === "string"
      ? name.normalize("NFKC").trim().replace(/\s+/g, "-")
      : name;
    if (!trimmedName) {
      return res.status(400).json({ error: "Repository name is required!" });
    }

    if (!/^[\p{L}\p{N}._-]+$/u.test(trimmedName)) {
      return res.status(400).json({ error: "Repository name contains invalid characters." });
    }

    if (await Repository.exists({ name: trimmedName })) {
      return res.status(409).json({ error: "A repository with this name already exists." });
    }

    if (!mongoose.Types.ObjectId.isValid(owner)) {
      return res.status(400).json({ error: "Invalid User ID!" });
    }

    const newRepository = new Repository({
      name: trimmedName,
      description,
      visibility,
      owner,
      content,
      issues,
    });

    const result = await newRepository.save();

    res.status(201).json({
      message: "Repository created!",
      repositoryID: result._id,
    });
  } catch (err) {
    console.error("Error during repository creation : ", err.message);
    res.status(500).send("Server error");
  }
}

async function getAllRepositories(req, res) {
  try {
    const repositories = await Repository.find({})
      .populate("owner")
      .populate("issues");

    res.json(repositories);
  } catch (err) {
    console.error("Error during fetching repositories : ", err.message);
    res.status(500).send("Server error");
  }
}


async function fetchRepositoryById(req, res) {
  const { id } = req.params;
  try {
    if (!isValidObjectId(id)) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    const repository = await Repository.findById(id)
      .populate("owner")
      .populate("issues");

    if (!repository) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    res.json(repository);
  } catch (err) {
    console.error("Error during fetching repository : ", err.message);
    res.status(500).json({ error: "Could not load repository." });
  }
}

async function fetchRepositoryByName(req, res) {
  const { name } = req.params;
  try {
    const repository = await Repository.find({ name })
      .populate("owner")
      .populate("issues");

    res.json(repository);
  } catch (err) {
    console.error("Error during fetching repository : ", err.message);
    res.status(500).send("Server error");
  }
}



async function fetchRepositoriesForCurrentUser(req, res) {
  const { userId } = req.params;

  try {
    if (!isValidObjectId(userId)) {
      return res.status(404).json({ error: "User Repositories not found!" });
    }

    const repositories = await Repository.find({ owner: new mongoose.Types.ObjectId(userId) })
      .populate("owner")
      .populate("issues");

    if (!repositories || repositories.length === 0) {
      return res.status(404).json({ error: "User Repositories not found!" });
    }

    res.json({ message: "Repositories found!", repositories });
  } catch (err) {
    console.error("Error during fetching user repositories : ", err.message);
    res.status(500).json({ error: "Could not load user repositories." });
  }
}


/* async function fetchRepositoriesForCurrentUser(req, res) {
  const { userId } = req.params;

  console.log("User ID:", userId);

  const allRepos = await Repository.find({});
  console.log("All Repositories:", allRepos);

  const repositories = await Repository.find({
    owner: userId,
  });

  console.log("Found Repositories:", repositories);

  if (!repositories || repositories.length === 0) {
    return res.status(404).json({
      error: "User Repositories not found!",
    });
  }

  res.json({
    message: "Repositories found!",
    repositories,
  });
}
 */

async function updateRepositoryById(req, res) {
  const { id } = req.params;
  const { content, description } = req.body;

  try {
    if (!isValidObjectId(id)) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    const repository = await Repository.findById(id);
    if (!repository) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    repository.content.push(content);
    repository.description = description;

    const updatedRepository = await repository.save();

    res.json({
      message: "Repository updated successfully!",
      repository: updatedRepository,
    });
  } catch (err) {
    console.error("Error during updating repository : ", err.message);
    res.status(500).json({ error: "Could not update repository." });
  }
}




async function toggleVisibilityById(req, res) {
  const { id } = req.params;

  try {
    if (!isValidObjectId(id)) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    const repository = await Repository.findById(id);
    if (!repository) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    repository.visibility = !repository.visibility;

    const updatedRepository = await repository.save();

    res.json({
      message: "Repository visibility toggled successfully!",
      repository: updatedRepository,
    });
  } catch (err) {
    console.error("Error during toggling visibility : ", err.message);
    res.status(500).json({ error: "Could not toggle repository visibility." });
  }
}



async function deleteRepositoryById(req, res) {
  const { id } = req.params;
  try {
    if (!isValidObjectId(id)) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    const repository = await Repository.findByIdAndDelete(id);
    if (!repository) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    res.json({ message: "Repository deleted successfully!" });
  } catch (err) {
    console.error("Error during deleting repository : ", err.message);
    res.status(500).json({ error: "Could not delete repository." });
  }
}

async function starRepository(req, res) {
  try {
    const { repoId, userId } = req.params;

    if (!isValidObjectId(repoId) || !isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid repository or user id." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (!user.starRepos.includes(repoId)) {
      user.starRepos.push(repoId);
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "Repository starred successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

module.exports = {
    createRepository,
  importRepository,
  fetchRepositoryFiles,
  downloadRepository,
  listRepositoryCommits,
  getRepositoryCommit,
  getRepositoryDiff,
  listBranches,
  createBranch,
  deleteBranch,
  listPullRequests,
  createPullRequest,
  getPullRequest,
  addPullRequestComment,
  getPullRequestDiff,
  reviewPullRequest,
  getRepositoryChangeDiff,
  closePullRequest,
  mergePullRequest,
    getAllRepositories,
    fetchRepositoryById,
    fetchRepositoryByName,
    fetchRepositoriesForCurrentUser,
    updateRepositoryById,
    toggleVisibilityById,
    deleteRepositoryById,
    starRepository,
};