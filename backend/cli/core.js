const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const os = require("os");

const GLOBAL_CONFIG_DIR = process.env.CODEVAULT_CONFIG_DIR || path.join(os.homedir(), ".codevault");
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");
const DEFAULT_API_URL = process.env.CODEVAULT_API_URL || "http://localhost:3002";

const EXCLUDED_DIRS = new Set([
  ".hiddengit",
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".vite",
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".vercel",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
]);

function isExcludedPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  for (const part of parts) {
    if (EXCLUDED_DIRS.has(part.toLowerCase())) {
      return true;
    }
  }
  const basename = path.basename(normalized).toLowerCase();
  if (basename === ".env" || basename.startsWith(".env.")) {
    return true;
  }
  if (basename.endsWith(".pem") || basename.endsWith(".key") || basename.endsWith(".p12") || basename.endsWith(".pfx")) {
    return true;
  }
  if (basename === "id_rsa" || basename === "id_ed25519" || basename === "id_ecdsa") {
    return true;
  }
  return false;
}

// Find repository root by traversing upwards looking for .hiddenGit
function findRepoRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const hiddenGitPath = path.join(current, ".hiddenGit");
    if (fsSync.existsSync(hiddenGitPath) && fsSync.statSync(hiddenGitPath).isDirectory()) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

async function getGlobalConfig() {
  try {
    if (fsSync.existsSync(GLOBAL_CONFIG_FILE)) {
      const data = await fs.readFile(GLOBAL_CONFIG_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch {}
  return {};
}

async function saveGlobalConfig(config) {
  await fs.mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file

async function getLocalConfig(repoRoot) {
  const configFile = path.join(repoRoot, ".hiddenGit", "config.json");
  try {
    if (fsSync.existsSync(configFile)) {
      const data = await fs.readFile(configFile, "utf8");
      const parsed = JSON.parse(data);
      if (parsed.repositoryId === "undefined" || parsed.repositoryId === "null" || parsed.repositoryId === "") {
        parsed.repositoryId = null;
      }
      return parsed;
    }
  } catch {}
  return {};
}

async function saveLocalConfig(repoRoot, config) {
  const hiddenGit = path.join(repoRoot, ".hiddenGit");
  await fs.mkdir(hiddenGit, { recursive: true });
  await fs.writeFile(path.join(hiddenGit, "config.json"), JSON.stringify(config, null, 2));
}

async function getActiveBranch(repoRoot) {
  const headFile = path.join(repoRoot, ".hiddenGit", "HEAD");
  try {
    if (fsSync.existsSync(headFile)) {
      const head = (await fs.readFile(headFile, "utf8")).trim();
      return head || "main";
    }
  } catch {}
  return "main";
}

async function setActiveBranch(repoRoot, branchName) {
  const headFile = path.join(repoRoot, ".hiddenGit", "HEAD");
  await fs.mkdir(path.dirname(headFile), { recursive: true });
  await fs.writeFile(headFile, branchName.trim());
}

async function getBranchHead(repoRoot, branchName) {
  const branchFile = path.join(repoRoot, ".hiddenGit", "branches", branchName);
  try {
    if (fsSync.existsSync(branchFile)) {
      return (await fs.readFile(branchFile, "utf8")).trim();
    }
  } catch {}
  return null;
}

async function setBranchHead(repoRoot, branchName, commitId) {
  const branchFile = path.join(repoRoot, ".hiddenGit", "branches", branchName);
  await fs.mkdir(path.dirname(branchFile), { recursive: true });
  await fs.writeFile(branchFile, commitId.trim());
}

// Recursively walk directory and return list of relative paths
async function walkDir(rootDir, currentDir = rootDir) {
  const results = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (isExcludedPath(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      const children = await walkDir(rootDir, fullPath);
      results.push(...children);
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }
  return results;
}

module.exports = {
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  DEFAULT_API_URL,
  isExcludedPath,
  findRepoRoot,
  getGlobalConfig,
  saveGlobalConfig,
  getLocalConfig,
  saveLocalConfig,
  getActiveBranch,
  setActiveBranch,
  getBranchHead,
  setBranchHead,
  walkDir,
  MAX_FILE_BYTES,
};
