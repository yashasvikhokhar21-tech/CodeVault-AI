const assert = require("assert");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const os = require("os");

// Isolate test configuration so real user login is never overwritten
process.env.CODEVAULT_CONFIG_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "codevault-test-cfg-"));

const {
  loginCommand,
  initCommand,
  cloneCommand,
  addCommand,
  commitCommand,
  pushCommand,
  pullCommand,
  branchCommand,
  checkoutCommand,
  prCommand,
  statusCommand,
  logCommand,
} = require("../cli/commands");
const { apiRequest } = require("../cli/api");

const API_URL = "http://localhost:3002";

async function run() {
  console.log("=== STARTING FULL CLI WORKFLOW VERIFICATION ===");

  // 1. LOGIN
  console.log("\n[TEST 1] codevault login");
  const loginResult = await loginCommand({
    email: "clitester@codevault.com",
    password: "Password123!",
    url: API_URL,
  });
  assert(loginResult.token, "Login should return a token");
  console.log("PASS: Login returned token");

  // Create a unique repo for this test
  const uniqueRepoName = `test-repo-${Date.now()}`;
  const createRes = await apiRequest("/repo/create", {
    method: "POST",
    apiUrl: API_URL,
    body: {
      owner: loginResult.userId,
      name: uniqueRepoName,
      description: "Automated CLI test repository",
      visibility: true,
      content: [],
      issues: [],
    },
  });
  const repoId = String(createRes.repositoryID);
  console.log(`Created test repository '${uniqueRepoName}' with ID: ${repoId}`);

  // Setup test workspace directory
  const testDir = path.join(os.tmpdir(), `codevault-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  // 2. INIT & LINK
  console.log("\n[TEST 2] codevault init --repo <repoId>");
  const initConfig = await initCommand({ repo: repoId, url: API_URL, cwd: testDir });
  assert.strictEqual(initConfig.repositoryId, repoId);
  assert.strictEqual(initConfig.branch, "main");
  assert(fsSync.existsSync(path.join(testDir, ".hiddenGit")), ".hiddenGit should exist");
  console.log("PASS: Initialized and linked repository");

  // 3. STATUS (clean)
  console.log("\n[TEST 3] codevault status (initial clean state)");
  const status1 = await statusCommand({ cwd: testDir });
  assert.strictEqual(status1.branch, "main");
  assert.strictEqual(status1.staged.length, 0);
  console.log("PASS: Clean status verified");

  // 4. CREATE FILES & EXCLUSION CHECK
  console.log("\n[TEST 4] Creating files including .env secret file");
  await fs.writeFile(path.join(testDir, "README.md"), "# CodeVault Demo\nWelcome to CodeVault.");
  await fs.writeFile(path.join(testDir, "index.js"), "console.log('Hello CodeVault');");
  await fs.mkdir(path.join(testDir, "src"), { recursive: true });
  await fs.writeFile(path.join(testDir, "src", "helper.js"), "module.exports = { test: true };");
  // Sensitive file to be excluded
  await fs.writeFile(path.join(testDir, ".env"), "SECRET_KEY=supersecret");
  await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });
  await fs.writeFile(path.join(testDir, "node_modules", "dummy.js"), "ignored");

  // 5. ADD .
  console.log("\n[TEST 5] codevault add .");
  const staged = await addCommand(["."], { cwd: testDir });
  assert(staged.includes("README.md"), "README.md should be staged");
  assert(staged.includes("index.js"), "index.js should be staged");
  assert(staged.includes("src/helper.js"), "src/helper.js should be staged");
  assert(!staged.includes(".env"), ".env MUST BE EXCLUDED");
  assert(!staged.some((f) => f.startsWith("node_modules")), "node_modules MUST BE EXCLUDED");
  console.log("PASS: Staged files correctly and excluded .env and node_modules");

  // 6. COMMIT
  console.log("\n[TEST 6] codevault commit -m 'Initial commit'");
  const commit1 = await commitCommand("Initial commit from CLI", { cwd: testDir });
  assert(commit1.commitId, "Commit should produce commitId");
  assert.strictEqual(commit1.branch, "main");
  console.log(`PASS: Created commit ${commit1.commitId}`);

  // 7. LOG (local)
  console.log("\n[TEST 7] codevault log");
  const logs1 = await logCommand({ cwd: testDir });
  assert(logs1.length >= 1, "Log should have at least 1 commit");
  assert.strictEqual(logs1[0].id, commit1.commitId);
  console.log("PASS: Verified local log");

  // 8. PUSH TO REMOTE
  console.log("\n[TEST 8] codevault push");
  const pushRes = await pushCommand({ cwd: testDir });
  assert.strictEqual(pushRes.branch, "main");
  assert.strictEqual(pushRes.head, commit1.commitId);
  assert.strictEqual(pushRes.commitsPushed, 1);
  console.log("PASS: Pushed commit to remote main branch");

  // 9. VERIFY ON WEBSITE / BACKEND
  console.log("\n[TEST 9] Verifying website backend reflects files and commits");
  const backendFiles = await apiRequest(`/repo/${repoId}/files?branch=main`, {
    token: loginResult.token,
    apiUrl: API_URL,
  });
  assert(backendFiles.files.some((f) => f.path === "README.md"), "Remote should have README.md");
  assert(backendFiles.files.some((f) => f.path === "src/helper.js"), "Remote should have src/helper.js");
  assert(!backendFiles.files.some((f) => f.path === ".env"), "Remote must NOT have .env");

  const backendCommits = await apiRequest(`/repo/${repoId}/commits?branch=main`, {
    token: loginResult.token,
    apiUrl: API_URL,
  });
  assert(backendCommits.some((c) => c.id === commit1.commitId), "Remote commits must include pushed commit");
  console.log("PASS: Remote website/backend verified with files and commit history!");

  // 10. BRANCH CREATE
  console.log("\n[TEST 10] codevault branch create feature-login");
  const branchRes = await branchCommand("create", "feature-login", { from: "main", cwd: testDir });
  assert.strictEqual(branchRes.name, "feature-login");
  console.log("PASS: Branch feature-login created");

  // 11. BRANCH LIST
  console.log("\n[TEST 11] codevault branch (list)");
  await branchCommand(null, null, { cwd: testDir });

  // 12. CHECKOUT
  console.log("\n[TEST 12] codevault checkout feature-login");
  const checkoutRes = await checkoutCommand("feature-login", { cwd: testDir });
  assert.strictEqual(checkoutRes.branch, "feature-login");
  console.log("PASS: Switched to feature-login");

  // 13. COMMIT ON NEW BRANCH & PUSH
  console.log("\n[TEST 13] Commit and push on feature-login branch");
  await fs.writeFile(path.join(testDir, "src", "auth.js"), "export const auth = true;");
  await addCommand(["."], { cwd: testDir });
  const commit2 = await commitCommand("Add authentication module", { cwd: testDir });
  const pushRes2 = await pushCommand({ cwd: testDir });
  assert.strictEqual(pushRes2.branch, "feature-login");
  assert.strictEqual(pushRes2.head, commit2.commitId);
  console.log("PASS: Pushed commit to feature-login branch");

  // 14. PR CREATE
  console.log("\n[TEST 14] codevault pr create");
  const prRes = await prCommand("create", {
    title: "Feature: User Authentication",
    description: "Implements client auth helpers",
    source: "feature-login",
    target: "main",
    cwd: testDir,
  });
  assert(prRes.number, "PR should have a number");
  assert.strictEqual(prRes.status, "OPEN");
  assert.strictEqual(prRes.sourceBranch, "feature-login");
  assert.strictEqual(prRes.targetBranch, "main");
  console.log(`PASS: Pull request #${prRes.number} created`);

  // 15. PR LIST
  console.log("\n[TEST 15] codevault pr list");
  const prs = await prCommand("list", { cwd: testDir });
  assert(prs.some((p) => p.number === prRes.number), "PR list must include created PR");
  console.log("PASS: PR list verified");

  // 16. CLONE REPOSITORY
  console.log("\n[TEST 16] codevault clone <repo>");
  const cloneDir = path.join(os.tmpdir(), `codevault-clone-${Date.now()}`);
  await cloneCommand(repoId, cloneDir);
  assert(fsSync.existsSync(path.join(cloneDir, "README.md")), "Cloned repo must contain README.md");
  assert(fsSync.existsSync(path.join(cloneDir, ".hiddenGit")), "Cloned repo must contain .hiddenGit");
  console.log("PASS: Clone verified");

  // 17. PULL
  console.log("\n[TEST 17] codevault pull");
  const pullRes = await pullCommand({ cwd: cloneDir });
  assert(pullRes.filesCount >= 2, "Pulled files should be present");
  console.log("PASS: Pull verified");

  // Cleanup temporary test dirs
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});

  console.log("\n=== ALL 17 AUTOMATED TESTS PASSED SUCCESSFULLY! ===");
}

run().catch((err) => {
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});
