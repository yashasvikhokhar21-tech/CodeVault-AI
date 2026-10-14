const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const readline = require("readline");
const { v4: uuidv4 } = require("uuid");
const {
  findRepoRoot,
  getLocalConfig,
  saveLocalConfig,
  getGlobalConfig,
  saveGlobalConfig,
  getActiveBranch,
  setActiveBranch,
  getBranchHead,
  setBranchHead,
  walkDir,
  isExcludedPath,
  MAX_FILE_BYTES,
  DEFAULT_API_URL,
} = require("./core");
const { getApiContext, apiRequest, resolveRemoteRepo } = require("./api");

// 1. LOGIN
async function loginCommand({ email, password, token, url = DEFAULT_API_URL } = {}) {
  let authToken = token ? token.trim() : null;
  let authUserId = null;
  let authEmail = email ? email.trim() : null;

  if (authToken) {
    try {
      const parts = authToken.split(".");
      if (parts.length < 2) throw new Error("Invalid JWT token format");
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      if (!payload.id) throw new Error("Token payload missing user id");
      authUserId = String(payload.id);
    } catch (e) {
      throw new Error(`Invalid authentication token: ${e.message}`);
    }

    try {
      const profile = await apiRequest(`/userprofile/${authUserId}`, {
        token: authToken,
        apiUrl: url,
      });
      if (profile && profile.email) {
        authEmail = profile.email;
      }
    } catch {}

    if (!authEmail) {
      authEmail = `user-${authUserId.slice(0, 8)}`;
    }
  } else {
    if (!email || !password) {
      throw new Error("Email and password (or --token) are required. Usage: codevault login --email <email> --password <password> OR codevault login --token <token>");
    }

    const result = await apiRequest("/login", {
      method: "POST",
      body: { email: email.trim(), password: password.trim() },
      apiUrl: url,
    });

    authToken = result.token;
    authUserId = String(result.userId);
    authEmail = email.trim();
  }

  const config = await getGlobalConfig();
  config.token = authToken;
  config.userId = authUserId;
  config.email = authEmail;
  config.apiUrl = url;
  await saveGlobalConfig(config);

  console.log(`✓ Logged in successfully as ${authEmail} (User ID: ${authUserId})`);
  console.log(`  API URL: ${url}`);
  return { token: authToken, userId: authUserId, email: authEmail };
}

// WHOAMI
async function whoamiCommand() {
  const globalConfig = await getGlobalConfig();
  if (!globalConfig.token) {
    console.log("Not logged in. Run 'codevault login' to authenticate.");
    return null;
  }
  console.log(`Logged in as: ${globalConfig.email || "Unknown"} (User ID: ${globalConfig.userId || "Unknown"})`);
  console.log(`API URL:      ${globalConfig.apiUrl || DEFAULT_API_URL}`);
  return globalConfig;
}

// 2. INIT
async function initCommand({ repo, url, cwd = process.cwd() } = {}) {
  const repoRoot = path.resolve(cwd);
  const hiddenGit = path.join(repoRoot, ".hiddenGit");

  await fs.mkdir(path.join(hiddenGit, "commits"), { recursive: true });
  await fs.mkdir(path.join(hiddenGit, "staging"), { recursive: true });
  await fs.mkdir(path.join(hiddenGit, "branches"), { recursive: true });

  await setActiveBranch(repoRoot, "main");

  const existingConfig = await getLocalConfig(repoRoot);
  const config = {
    ...existingConfig,
    remoteUrl: url || existingConfig.remoteUrl || DEFAULT_API_URL,
    branch: "main",
  };

  if (repo) {
    const { token } = await getApiContext();
    const resolved = await resolveRemoteRepo(repo, { token, apiUrl: config.remoteUrl });
    config.repositoryId = resolved.id;
    config.repositoryName = resolved.name;
    console.log(`✓ Linked to remote repository: ${resolved.name} (${resolved.id})`);
  } else {
    if (existingConfig.repositoryId && /^[0-9a-fA-F]{24}$/.test(existingConfig.repositoryId)) {
      config.repositoryId = existingConfig.repositoryId;
      config.repositoryName = existingConfig.repositoryName;
    } else {
      config.repositoryId = null;
      config.repositoryName = null;
    }
  }

  await saveLocalConfig(repoRoot, config);
  console.log(`✓ Initialized empty CodeVault repository in ${path.join(repoRoot, ".hiddenGit")}`);
  return config;
}

// LINK REPOSITORY
async function linkCommand(repoIdentifier, { url, cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }
  if (!repoIdentifier) {
    throw new Error("Repository identifier is required. Usage: codevault link <repository-id|name>");
  }

  const existingConfig = await getLocalConfig(repoRoot);
  const { token, apiUrl } = await getApiContext(repoRoot);
  const targetUrl = url || existingConfig.remoteUrl || apiUrl;

  const resolved = await resolveRemoteRepo(repoIdentifier, { token, apiUrl: targetUrl });
  const config = {
    ...existingConfig,
    repositoryId: resolved.id,
    repositoryName: resolved.name,
    remoteUrl: targetUrl,
  };
  await saveLocalConfig(repoRoot, config);
  console.log(`✓ Successfully linked to CodeVault repository: ${resolved.name} (${resolved.id})`);
  return config;
}

// 3. CLONE
async function cloneCommand(repositoryArg, targetDirArg, { cwd = process.cwd() } = {}) {
  if (!repositoryArg) {
    throw new Error("Repository argument is required. Usage: codevault clone <repository-id|name|url> [directory]");
  }

  const { token, apiUrl } = await getApiContext();
  const repoData = await resolveRemoteRepo(repositoryArg, { token, apiUrl });
  const repoId = repoData.id;
  const repoName = repoData.name;
  const targetDir = path.resolve(cwd, targetDirArg || repoName);

  if (fsSync.existsSync(targetDir) && (await fs.readdir(targetDir)).length > 0) {
    throw new Error(`Target directory '${path.basename(targetDir)}' already exists and is not empty.`);
  }

  console.log(`Cloning into '${path.basename(targetDir)}'...`);
  await fs.mkdir(targetDir, { recursive: true });

  // Fetch files for main branch
  let filesData = { files: [], commits: [] };
  try {
    filesData = await apiRequest(`/repo/${repoId}/files?branch=main`, { token, apiUrl });
  } catch {}

  // Write files
  const files = filesData.files || [];
  for (const file of files) {
    const fullPath = path.resolve(targetDir, ...file.path.split("/"));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content || "");
  }

  // Initialize .hiddenGit
  const hiddenGit = path.join(targetDir, ".hiddenGit");
  await fs.mkdir(path.join(hiddenGit, "commits"), { recursive: true });
  await fs.mkdir(path.join(hiddenGit, "staging"), { recursive: true });
  await fs.mkdir(path.join(hiddenGit, "branches"), { recursive: true });

  await saveLocalConfig(targetDir, {
    repositoryId: repoId,
    repositoryName: repoName,
    remoteUrl: apiUrl,
    branch: "main",
  });
  await setActiveBranch(targetDir, "main");

  // Fetch commits
  let commits = [];
  try {
    commits = await apiRequest(`/repo/${repoId}/commits?branch=main`, { token, apiUrl });
  } catch {}

  if (Array.isArray(commits) && commits.length) {
    for (const commit of commits) {
      const commitDir = path.join(hiddenGit, "commits", commit.id);
      await fs.mkdir(commitDir, { recursive: true });
      await fs.writeFile(
        path.join(commitDir, "commit.json"),
        JSON.stringify({ message: commit.message, date: commit.date })
      );
    }
    const latestCommit = commits[commits.length - 1];
    await setBranchHead(targetDir, "main", latestCommit.id);
  }

  console.log(`✓ Cloned '${repoName}' successfully (${files.length} file(s), ${commits.length} commit(s)).`);
  return { repoId, repoName, targetDir };
}

// 4. ADD
async function addCommand(patterns = ["."], { cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository (or any parent up to root). Run 'codevault init' first.");
  }

  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  const stagingDir = path.join(hiddenGit, "staging");
  await fs.mkdir(stagingDir, { recursive: true });

  const filesToAdd = new Set();
  const patternList = Array.isArray(patterns) ? patterns : [patterns];

  for (const pattern of patternList) {
    if (pattern === "." || pattern === "./") {
      const allFiles = await walkDir(repoRoot);
      for (const f of allFiles) {
        filesToAdd.add(f);
      }
    } else {
      const targetPath = path.resolve(cwd, pattern);
      const relative = path.relative(repoRoot, targetPath).replace(/\\/g, "/");
      if (isExcludedPath(relative)) continue;

      if (!fsSync.existsSync(targetPath)) {
        throw new Error(`Path does not exist: ${pattern}`);
      }
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        const subFiles = await walkDir(repoRoot, targetPath);
        for (const f of subFiles) filesToAdd.add(f);
      } else if (stat.isFile()) {
        filesToAdd.add(relative);
      }
    }
  }

  let addedCount = 0;
  for (const relPath of filesToAdd) {
    const sourceFile = path.resolve(repoRoot, ...relPath.split("/"));
    const stat = await fs.stat(sourceFile);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `File '${relPath}' exceeds the 10MB limit (${(stat.size / (1024 * 1024)).toFixed(2)}MB). CodeVault is designed for code files. Please add large files to your exclusion list or remove them.`
      );
    }
    const destFile = path.resolve(stagingDir, ...relPath.split("/"));
    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.copyFile(sourceFile, destFile);
    addedCount++;
  }

  console.log(`✓ Staged ${addedCount} file(s) for commit.`);
  return Array.from(filesToAdd);
}

// Helper for sensitive path detection
function isSensitivePath(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12") || base.endsWith(".pfx")) return true;
  if (base === "id_rsa" || base === "id_ed25519" || base === "id_ecdsa") return true;
  return false;
}

// Helper for unified line diffs
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

// Redact secrets from diffs before sending to AI
function redactSecrets(text) {
  if (!text) return "";
  let sanitized = String(text);
  sanitized = sanitized.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]");
  sanitized = sanitized.replace(/\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z-_]{35}\b/g, "[REDACTED_API_KEY]");
  sanitized = sanitized.replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g, "[REDACTED_GITHUB_TOKEN]");
  sanitized = sanitized.replace(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g, "[REDACTED_GITHUB_TOKEN]");
  sanitized = sanitized.replace(/\bxox[baprs]-[0-9a-zA-Z-]{10,48}\b/g, "[REDACTED_SLACK_TOKEN]");
  sanitized = sanitized.replace(/\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b/g, "[REDACTED_JWT]");
  sanitized = sanitized.replace(
    /\b([a-zA-Z0-9_.-]*(?:password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|bearer|private[_-]?key))\b\s*([:=])\s*(['"][^'"]*['"]|[^\s,;]+)/gi,
    (match, key, op) => `${key}${op === ":" ? ":" : " ="} "[REDACTED]"`
  );
  return sanitized;
}

// Build unified diff from staged files compared against the active branch parent commit
async function buildStagedDiff(repoRoot) {
  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  const stagingDir = path.join(hiddenGit, "staging");

  if (!fsSync.existsSync(stagingDir)) {
    return { hasStaged: false, hasChanges: false, changedFiles: [], diff: "" };
  }

  const stagedRelPaths = await walkDir(stagingDir);
  if (!stagedRelPaths.length) {
    return { hasStaged: false, hasChanges: false, changedFiles: [], diff: "" };
  }

  const stagedMap = new Map();
  for (const relPath of stagedRelPaths) {
    const full = path.join(stagingDir, ...relPath.split("/"));
    stagedMap.set(relPath, await fs.readFile(full));
  }

  const branch = await getActiveBranch(repoRoot);
  const parentCommitId = await getBranchHead(repoRoot, branch);
  const parentMap = new Map();

  if (parentCommitId) {
    const parentDir = path.join(hiddenGit, "commits", parentCommitId);
    if (fsSync.existsSync(parentDir)) {
      const parentRelPaths = await walkDir(parentDir);
      for (const relPath of parentRelPaths) {
        if (relPath === "commit.json") continue;
        const full = path.join(parentDir, ...relPath.split("/"));
        parentMap.set(relPath, await fs.readFile(full));
      }
    }
  }

  const allPaths = [...new Set([...parentMap.keys(), ...stagedMap.keys()])].sort();
  const changedFiles = [];

  for (const filePath of allPaths) {
    const parentBuf = parentMap.get(filePath);
    const stagedBuf = stagedMap.get(filePath);
    if (!parentBuf) {
      changedFiles.push({ path: filePath, status: "Added" });
    } else if (!stagedBuf) {
      changedFiles.push({ path: filePath, status: "Deleted" });
    } else if (!parentBuf.equals(stagedBuf)) {
      changedFiles.push({ path: filePath, status: "Modified" });
    }
  }

  if (!changedFiles.length) {
    return { hasStaged: true, hasChanges: false, changedFiles: [], diff: "", branch };
  }

  const MAX_DIFF_CHARS = 24000;
  const chunks = changedFiles.map((file) => {
    if (isSensitivePath(file.path)) {
      return `--- a/${file.path}\n+++ b/${file.path} (${file.status})\n[File omitted: sensitive configuration file]`;
    }

    const current = stagedMap.get(file.path);
    const previous = parentMap.get(file.path);
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

  let rawDiff = redactSecrets(chunks.join("\n\n"));
  if (rawDiff.length > MAX_DIFF_CHARS) {
    rawDiff = `${rawDiff.slice(0, MAX_DIFF_CHARS)}\n\n[Diff truncated: staged changes exceeded 24,000 characters limit.]`;
  }

  return {
    hasStaged: true,
    hasChanges: true,
    changedFiles,
    diff: rawDiff,
    branch,
  };
}

// Generate commit message preview from staged changes without committing
async function generateCommitMessageCommand({ cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const { apiUrl, token, repositoryId } = await getApiContext(repoRoot);

  if (!repositoryId || repositoryId === "undefined" || repositoryId === "null" || !/^[0-9a-fA-F]{24}$/.test(repositoryId)) {
    throw new Error(
      "No CodeVault repository linked. Run 'codevault link <repository>' or 'codevault init --repo <id>' to link your repository before generating AI commit messages."
    );
  }
  if (!token) {
    throw new Error("Authentication required. Please run 'codevault login' first.");
  }

  const stagedInfo = await buildStagedDiff(repoRoot);
  if (!stagedInfo.hasStaged) {
    throw new Error("No staged changes found. Use 'codevault add .' to stage changes before generating an AI commit message.");
  }
  if (!stagedInfo.hasChanges) {
    throw new Error("No changed files detected between staged files and the parent commit. Make changes to files and stage them with 'codevault add .'.");
  }

  console.log(`Analyzing ${stagedInfo.changedFiles.length} staged file(s)...`);
  for (const file of stagedInfo.changedFiles) {
    const symbol = file.status === "Added" ? "+" : file.status === "Deleted" ? "-" : "~";
    console.log(`  ${symbol} ${file.path} [${file.status}]`);
  }

  const headers = {};
  if (process.env.CODEVAULT_TEST_AI_SUGGESTION) {
    headers["x-test-ai-suggestion"] = process.env.CODEVAULT_TEST_AI_SUGGESTION;
  }

  let result;
  try {
    result = await apiRequest(`/ai/repositories/${repositoryId}/commit-message`, {
      method: "POST",
      token,
      apiUrl,
      headers,
      body: {
        branch: stagedInfo.branch,
        diff: stagedInfo.diff,
      },
    });
  } catch (err) {
    if (err.status === 401) {
      throw new Error("Authentication failed or token expired. Please run 'codevault login' to sign in again.");
    }
    if (err.status === 403) {
      throw new Error("Access denied. Only the repository owner can generate AI commit messages.");
    }
    if (err.status === 404) {
      throw new Error(`Repository with ID '${repositoryId}' was not found on remote server.`);
    }
    if (err.status === 429) {
      throw new Error(err.message || "Gemini AI rate limit or quota exceeded. Please wait briefly before trying again.");
    }
    if (err.status >= 500) {
      throw new Error(`CodeVault AI service is temporarily unavailable: ${err.message}`);
    }
    throw err;
  }

  const suggestedMessage = (result?.message || "").trim();
  if (!suggestedMessage) {
    throw new Error("AI returned an empty commit message. Please provide a message manually with -m \"message\".");
  }

  console.log("\nSuggested commit message:");
  console.log(`  ${suggestedMessage}\n`);

  return {
    message: suggestedMessage,
    suggestedMessage,
    changedFiles: stagedInfo.changedFiles,
    diff: stagedInfo.diff,
  };
}

// 5. COMMIT
async function commitCommand(message, { cwd = process.cwd(), ai = false, accept = false, editMessage = null, promptFn = null } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  let finalMessage = "";

  if (ai) {
    const aiResult = await generateCommitMessageCommand({ cwd });
    const suggestedMessage = aiResult.message;

    if (accept || editMessage) {
      finalMessage = editMessage ? editMessage.trim() : suggestedMessage;
    } else if (typeof promptFn === "function" || process.stdin.isTTY) {
      console.log("Actions:");
      console.log("  [c] Accept and commit with suggested message (default)");
      console.log("  [e] Edit message before committing");
      console.log("  [a] Abort commit\n");

      const askPrompt = typeof promptFn === "function"
        ? promptFn
        : (question) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            return new Promise((resolve) => {
              rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim());
              });
            });
          };

      const choice = (await askPrompt("Choose action [c/e/a] (default: c): ")) || "c";
      const normalizedChoice = choice.trim().toLowerCase();

      if (normalizedChoice === "a" || normalizedChoice === "abort") {
        console.log("Commit aborted.");
        return null;
      } else if (normalizedChoice === "e" || normalizedChoice === "edit") {
        const customMessage = await askPrompt("Enter commit message: ");
        if (!customMessage || !customMessage.trim()) {
          throw new Error("Commit message cannot be empty. Commit aborted.");
        }
        finalMessage = customMessage.trim();
      } else {
        finalMessage = suggestedMessage;
      }
    } else {
      console.log("Non-interactive terminal: Use --yes / -y to accept the AI suggested commit message, or provide -m \"message\".");
      return null;
    }
  } else {
    finalMessage = typeof message === "string" ? message.trim() : "";
    if (!finalMessage) {
      throw new Error("Commit message is required. Usage: codevault commit -m \"commit message\" or codevault commit --ai");
    }
  }

  if (!finalMessage) {
    throw new Error("Commit message is required.");
  }

  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  const stagingDir = path.join(hiddenGit, "staging");

  if (!fsSync.existsSync(stagingDir)) {
    throw new Error("Nothing to commit (staging area is empty). Use 'codevault add .' first.");
  }

  const stagedFiles = await walkDir(stagingDir);
  if (!stagedFiles.length) {
    throw new Error("Nothing to commit (no files staged). Use 'codevault add .' first.");
  }

  const commitId = uuidv4();
  const commitDir = path.join(hiddenGit, "commits", commitId);
  await fs.mkdir(commitDir, { recursive: true });

  for (const relPath of stagedFiles) {
    const src = path.join(stagingDir, ...relPath.split("/"));
    const dest = path.join(commitDir, ...relPath.split("/"));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }

  const commitData = {
    message: finalMessage,
    date: new Date().toISOString(),
  };
  await fs.writeFile(path.join(commitDir, "commit.json"), JSON.stringify(commitData, null, 2));

  const branch = await getActiveBranch(repoRoot);
  await setBranchHead(repoRoot, branch, commitId);

  // Clear staging
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  console.log(`[${branch} ${commitId}] ${finalMessage}`);
  console.log(` ${stagedFiles.length} file(s) committed`);
  return { commitId, message: finalMessage, branch, files: stagedFiles };
}

// 6. PUSH
async function pushCommand({ cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const { apiUrl, token, repositoryId, localConfig } = await getApiContext(repoRoot);

  if (!repositoryId || repositoryId === "undefined" || repositoryId === "null" || !/^[0-9a-fA-F]{24}$/.test(repositoryId)) {
    throw new Error("No CodeVault repository linked. Run 'codevault init --repo <id|name>' to link your repository before pushing.");
  }
  if (!token) {
    throw new Error("Authentication required. Please run 'codevault login' first.");
  }

  const branch = await getActiveBranch(repoRoot);
  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  const commitsDir = path.join(hiddenGit, "commits");

  if (!fsSync.existsSync(commitsDir)) {
    console.log("No commits to push.");
    return { message: "No commits to push.", branch, commitsPushed: 0 };
  }

  const commitFolders = (await fs.readdir(commitsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (!commitFolders.length) {
    console.log("No commits to push.");
    return { message: "No commits to push.", branch, commitsPushed: 0 };
  }

  // Fetch remote commits to avoid re-pushing already pushed commits
  const remoteCommitIds = new Set();
  try {
    const remoteCommits = await apiRequest(`/repo/${repositoryId}/commits?branch=${encodeURIComponent(branch)}`, {
      token,
      apiUrl,
    });
    if (Array.isArray(remoteCommits)) {
      for (const rc of remoteCommits) {
        if (rc && rc.id) remoteCommitIds.add(rc.id);
      }
    }
  } catch (err) {
    // If remote repository branch doesn't exist yet, proceed with pushing all local commits
  }

  // Load and sort all local commits chronologically
  const allLocalCommits = [];
  for (const commitId of commitFolders) {
    const cDir = path.join(commitsDir, commitId);
    let info = { message: "Commit", date: new Date().toISOString() };
    try {
      const raw = await fs.readFile(path.join(cDir, "commit.json"), "utf8");
      info = JSON.parse(raw);
    } catch {}

    allLocalCommits.push({
      id: commitId,
      message: info.message,
      date: info.date,
      cDir,
    });
  }

  allLocalCommits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Filter only unpushed commits
  const unpushed = allLocalCommits.filter((c) => !remoteCommitIds.has(c.id));

  const currentBranchHead = await getBranchHead(repoRoot, branch) || allLocalCommits[allLocalCommits.length - 1]?.id;

  if (unpushed.length === 0) {
    console.log("Everything up to date. No new commits to push.");
    return { message: "Everything up to date.", branch, head: currentBranchHead, commitsPushed: 0 };
  }

  console.log(`Pushing ${unpushed.length} commit(s) to ${apiUrl}/repo/${repositoryId} (branch: ${branch})...`);

  const MAX_COMMIT_BYTES = 45 * 1024 * 1024; // 45MB commit bound (within 50MB express limit)
  let lastResponse = null;

  // Push unpushed commits sequentially (commit by commit)
  for (let i = 0; i < unpushed.length; i++) {
    const c = unpushed[i];
    const fileRelPaths = await walkDir(c.cDir);
    const files = [];
    let commitBytes = 0;

    for (const f of fileRelPaths) {
      if (f === "commit.json") continue;
      const filePath = path.join(c.cDir, ...f.split("/"));
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(
          `File '${f}' in commit ${c.id.slice(0, 8)} exceeds the 10MB limit (${(stat.size / (1024 * 1024)).toFixed(2)}MB).`
        );
      }
      commitBytes += stat.size;
      const content = await fs.readFile(filePath, "utf8");
      files.push({ path: f, content });
    }

    if (commitBytes > MAX_COMMIT_BYTES) {
      throw new Error(
        `Commit ${c.id.slice(0, 8)} payload size (${(commitBytes / (1024 * 1024)).toFixed(2)}MB) exceeds the 45MB commit limit. Please split into smaller commits.`
      );
    }

    const payload = {
      id: c.id,
      message: c.message,
      date: c.date,
      files,
    };

    const isLast = i === unpushed.length - 1;
    const branchHead = isLast ? (currentBranchHead || c.id) : c.id;

    lastResponse = await apiRequest(`/repo/${repositoryId}/push`, {
      method: "POST",
      token,
      apiUrl,
      body: {
        branch,
        head: branchHead,
        commits: [payload],
      },
    });

    localConfig.lastPushedHead = branchHead;
    await saveLocalConfig(repoRoot, localConfig);
  }

  console.log(`✓ Push successful!`);
  console.log(`  Branch: ${lastResponse ? lastResponse.branch : branch}`);
  console.log(`  Head:   ${lastResponse ? lastResponse.head : currentBranchHead}`);
  console.log(`  Pushed: ${unpushed.length} commit(s)`);
  return {
    ...lastResponse,
    commitsPushed: unpushed.length,
  };
}

// 7. PULL
async function pullCommand({ cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const { apiUrl, token, repositoryId } = await getApiContext(repoRoot);
  if (!repositoryId) {
    throw new Error("No remote repository linked. Use 'codevault clone' or 'codevault init --repo <id>'.");
  }

  const branch = await getActiveBranch(repoRoot);
  console.log(`Pulling from ${apiUrl}/repo/${repositoryId} (branch: ${branch})...`);

  const [filesResult, commitsResult] = await Promise.all([
    apiRequest(`/repo/${repositoryId}/files?branch=${encodeURIComponent(branch)}`, { token, apiUrl }),
    apiRequest(`/repo/${repositoryId}/commits?branch=${encodeURIComponent(branch)}`, { token, apiUrl }).catch(() => []),
  ]);

  const files = filesResult.files || [];
  for (const file of files) {
    const fullPath = path.resolve(repoRoot, ...file.path.split("/"));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content || "");
  }

  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  const commits = Array.isArray(commitsResult) ? commitsResult : [];
  for (const commit of commits) {
    const cDir = path.join(hiddenGit, "commits", commit.id);
    await fs.mkdir(cDir, { recursive: true });
    await fs.writeFile(
      path.join(cDir, "commit.json"),
      JSON.stringify({ message: commit.message, date: commit.date })
    );
  }

  if (commits.length) {
    await setBranchHead(repoRoot, branch, commits[commits.length - 1].id);
  }

  console.log(`✓ Pulled ${files.length} file(s). Current branch '${branch}' is up to date.`);
  return { filesCount: files.length, commitsCount: commits.length };
}

// 8. BRANCH
async function branchCommand(subAction, branchName, { from, cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const { apiUrl, token, repositoryId } = await getApiContext(repoRoot);
  const activeBranch = await getActiveBranch(repoRoot);

  if (subAction === "create") {
    if (!branchName) {
      throw new Error("Branch name is required. Usage: codevault branch create <name>");
    }
    const name = branchName.trim();
    const source = from || activeBranch;

    if (!repositoryId) {
      throw new Error("No remote repository linked to create branches on.");
    }
    if (!token) {
      throw new Error("Authentication required. Run 'codevault login' first.");
    }

    console.log(`Creating branch '${name}' from '${source}'...`);
    const result = await apiRequest(`/repo/${repositoryId}/branches/${encodeURIComponent(name)}`, {
      method: "POST",
      token,
      apiUrl,
      body: { from: source },
    });

    // Create local branch pointer
    const head = await getBranchHead(repoRoot, source);
    if (head) {
      await setBranchHead(repoRoot, name, head);
    }

    console.log(`✓ Branch '${name}' created successfully.`);
    return result;
  }

  // List branches
  let remoteBranches = [];
  if (repositoryId && token) {
    try {
      remoteBranches = await apiRequest(`/repo/${repositoryId}/branches`, { token, apiUrl });
    } catch {}
  }

  const branchSet = new Set(remoteBranches.map((b) => b.name));
  branchSet.add("main");
  branchSet.add(activeBranch);

  console.log("Branches:");
  for (const b of Array.from(branchSet).sort()) {
    const isCurrent = b === activeBranch;
    const marker = isCurrent ? "* " : "  ";
    const remoteInfo = remoteBranches.find((r) => r.name === b);
    const details = remoteInfo ? ` (${remoteInfo.commits} commit(s))` : "";
    console.log(`${marker}${b}${details}`);
  }
}

// 9. CHECKOUT
async function checkoutCommand(branchName, { cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }
  if (!branchName) {
    throw new Error("Branch name is required. Usage: codevault checkout <branch>");
  }

  const name = branchName.trim();
  const { apiUrl, token, repositoryId } = await getApiContext(repoRoot);

  // Switch active branch
  await setActiveBranch(repoRoot, name);

  // Update working tree files if connected
  if (repositoryId) {
    try {
      const filesResult = await apiRequest(`/repo/${repositoryId}/files?branch=${encodeURIComponent(name)}`, {
        token,
        apiUrl,
      });
      const files = filesResult.files || [];
      for (const file of files) {
        const fullPath = path.resolve(repoRoot, ...file.path.split("/"));
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content || "");
      }
    } catch {}
  }

  console.log(`✓ Switched to branch '${name}'.`);
  return { branch: name };
}

// 10. PR CREATE & LIST
async function prCommand(subAction, { title, description = "", source, target = "main", cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const { apiUrl, token, repositoryId } = await getApiContext(repoRoot);
  if (!repositoryId) {
    throw new Error("No remote repository linked.");
  }
  if (!token) {
    throw new Error("Authentication required. Run 'codevault login' first.");
  }

  if (subAction === "list") {
    const pullRequests = await apiRequest(`/repo/${repositoryId}/pulls`, { token, apiUrl });
    if (!Array.isArray(pullRequests) || !pullRequests.length) {
      console.log("No pull requests found.");
      return [];
    }

    console.log(`Pull requests for repository (${pullRequests.length}):`);
    console.log("------------------------------------------------------------");
    for (const pr of pullRequests) {
      const statusBadge = `[${pr.status}]`.padEnd(9);
      const author = pr.author?.username || "unknown";
      console.log(`#${pr.number} ${statusBadge} ${pr.title}`);
      console.log(`    ${pr.sourceBranch} -> ${pr.targetBranch} | by ${author}`);
    }
    return pullRequests;
  }

  if (subAction === "create") {
    const currentBranch = await getActiveBranch(repoRoot);
    const sourceBranch = (source || currentBranch).trim();
    const targetBranch = target.trim();

    if (!title || !title.trim()) {
      throw new Error("Pull request title is required. Usage: codevault pr create --title \"Title\" [--source <branch>] [--target <branch>]");
    }

    if (sourceBranch === targetBranch) {
      throw new Error(`Source and target branches must be different (both are '${sourceBranch}').`);
    }

    console.log(`Creating pull request from '${sourceBranch}' into '${targetBranch}'...`);
    const pr = await apiRequest(`/repo/${repositoryId}/pulls`, {
      method: "POST",
      token,
      apiUrl,
      body: {
        title: title.trim(),
        description: description.trim(),
        sourceBranch,
        targetBranch,
      },
    });

    console.log(`✓ Pull request #${pr.number} created successfully: "${pr.title}"`);
    console.log(`  Status: ${pr.status}`);
    console.log(`  Branches: ${pr.sourceBranch} -> ${pr.targetBranch}`);
    return pr;
  }

  throw new Error(`Unknown PR sub-command '${subAction}'. Use 'codevault pr create' or 'codevault pr list'.`);
}

// 11. STATUS
async function statusCommand({ cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const branch = await getActiveBranch(repoRoot);
  const { repositoryName, repositoryId } = await getLocalConfig(repoRoot);

  console.log(`On branch: ${branch}`);
  if (repositoryName) {
    console.log(`Linked repository: ${repositoryName} (${repositoryId})`);
  } else {
    console.log("Local repository (unlinked to remote).");
  }

  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  const stagingDir = path.join(hiddenGit, "staging");

  const stagedFiles = fsSync.existsSync(stagingDir) ? await walkDir(stagingDir) : [];
  const workingFiles = await walkDir(repoRoot);

  console.log("\nChanges staged for commit:");
  if (stagedFiles.length) {
    for (const f of stagedFiles) {
      console.log(`  (staged)   ${f}`);
    }
  } else {
    console.log("  (no files staged. Use 'codevault add .' to stage files)");
  }

  const untracked = workingFiles.filter((f) => !stagedFiles.includes(f));
  if (untracked.length) {
    console.log("\nUntracked / unstaged files in working directory:");
    for (const f of untracked) {
      console.log(`  (unstaged) ${f}`);
    }
  }

  return { branch, staged: stagedFiles, untracked };
}

// 12. LOG
async function logCommand({ cwd = process.cwd() } = {}) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a CodeVault repository. Run 'codevault init' first.");
  }

  const branch = await getActiveBranch(repoRoot);
  const { apiUrl, token, repositoryId } = await getApiContext(repoRoot);

  // Try remote commits first if linked, else local
  let commits = [];
  if (repositoryId && token) {
    try {
      commits = await apiRequest(`/repo/${repositoryId}/commits?branch=${encodeURIComponent(branch)}`, {
        token,
        apiUrl,
      });
    } catch {}
  }

  if (!commits.length) {
    // Read local commits
    const commitsDir = path.join(repoRoot, ".hiddenGit", "commits");
    if (fsSync.existsSync(commitsDir)) {
      const folders = (await fs.readdir(commitsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((e) => e.name);

      for (const id of folders) {
        try {
          const raw = await fs.readFile(path.join(commitsDir, id, "commit.json"), "utf8");
          const info = JSON.parse(raw);
          commits.push({ id, ...info });
        } catch {}
      }
      commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
  }

  console.log(`Commit log for branch '${branch}' (${commits.length} commit(s)):`);
  console.log("------------------------------------------------------------");
  if (!commits.length) {
    console.log("No commits yet.");
    return [];
  }

  for (const c of commits) {
    console.log(`commit ${c.id}`);
    console.log(`Date:    ${new Date(c.date).toLocaleString()}`);
    console.log(`\n    ${c.message}\n`);
  }
  return commits;
}

module.exports = {
  loginCommand,
  initCommand,
  linkCommand,
  cloneCommand,
  addCommand,
  commitCommand,
  buildStagedDiff,
  generateCommitMessageCommand,
  pushCommand,
  pullCommand,
  branchCommand,
  checkoutCommand,
  prCommand,
  statusCommand,
  logCommand,
  whoamiCommand,
};
