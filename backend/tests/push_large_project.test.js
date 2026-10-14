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
  linkCommand,
  addCommand,
  commitCommand,
  pushCommand,
  statusCommand,
  logCommand,
} = require("../cli/commands");
const { apiRequest, resolveRemoteRepo } = require("../cli/api");

const API_URL = "http://localhost:3002";

async function runTests() {
  console.log("=== STARTING PUSH FAILURE & 42-FILE WORKFLOW TEST ===");

  // 1. Authenticate test user
  console.log("\n[TEST 1] Logging in CLI user...");
  const loginRes = await loginCommand({
    email: "clitester@codevault.com",
    password: "Password123!",
    url: API_URL,
  });
  assert(loginRes.token, "Must have auth token");

  // Create remote repository on backend
  const repoName = `repo-42files-${Date.now()}`;
  const createRes = await apiRequest("/repo/create", {
    method: "POST",
    apiUrl: API_URL,
    body: {
      owner: loginRes.userId,
      name: repoName,
      description: "Test repository for 42 files push and ID resolution",
      visibility: true,
      content: [],
      issues: [],
    },
  });
  const repoId = String(createRes.repositoryID);
  assert(/^[0-9a-fA-F]{24}$/.test(repoId), "Created repo must have valid 24-hex ObjectId");
  console.log(`✓ Remote repository created: ${repoName} (${repoId})`);

  // 2. Test: Unlinked push rejection (prevent /repo/undefined)
  console.log("\n[TEST 2] Verifying unlinked repo push rejection...");
  const unlinkedDir = path.join(os.tmpdir(), `codevault-unlinked-${Date.now()}`);
  await fs.mkdir(unlinkedDir, { recursive: true });
  await initCommand({ cwd: unlinkedDir });
  let unlinkedFailed = false;
  try {
    await pushCommand({ cwd: unlinkedDir });
  } catch (err) {
    unlinkedFailed = true;
    assert(
      err.message.includes("No CodeVault repository linked"),
      `Expected 'No CodeVault repository linked' error, got: ${err.message}`
    );
    assert(!err.message.includes("/repo/undefined"), "Must never construct /repo/undefined URL");
  }
  assert(unlinkedFailed, "Pushing unlinked repo must fail before making network request");
  console.log("PASS: Unlinked repo push rejected cleanly with actionable error");
  await fs.rm(unlinkedDir, { recursive: true, force: true }).catch(() => {});

  // 3. Test: Non-existent repo name lookup rejection
  console.log("\n[TEST 3] Verifying non-existent repo resolution rejection...");
  let nonexistentFailed = false;
  try {
    await resolveRemoteRepo("definitely-nonexistent-repo-xyz-9999", {
      token: loginRes.token,
      apiUrl: API_URL,
    });
  } catch (err) {
    nonexistentFailed = true;
    assert(err.message.includes("not found"), `Expected 'not found' error, got: ${err.message}`);
  }
  assert(nonexistentFailed, "Nonexistent repo lookup must throw error");
  console.log("PASS: Nonexistent repo resolution correctly rejected");

  // 4. Test: Linking by Name (resolves array response from /repo/name/:name)
  console.log("\n[TEST 4] Verifying linking by repository name...");
  const workDir = path.join(os.tmpdir(), `codevault-42files-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });
  const initConfig = await initCommand({ repo: repoName, url: API_URL, cwd: workDir });
  assert.strictEqual(initConfig.repositoryId, repoId, "Must store valid 24-hex ObjectId, not undefined");
  assert.strictEqual(initConfig.repositoryName, repoName);
  console.log(`PASS: Linked by name successfully to ID ${initConfig.repositoryId}`);

  // 5. Generate 42 realistic project files
  console.log("\n[TEST 5] Generating realistic 42-file project structure...");
  const directories = [
    "src/components",
    "src/utils",
    "src/hooks",
    "src/styles",
    "src/services",
    "public/assets",
    "docs",
    "config",
  ];
  for (const dir of directories) {
    await fs.mkdir(path.join(workDir, dir), { recursive: true });
  }

  // Create exactly 42 files
  let fileCount = 0;

  // 10 components
  for (let i = 1; i <= 10; i++) {
    await fs.writeFile(
      path.join(workDir, "src", "components", `Component${i}.jsx`),
      `import React from "react";\nexport function Component${i}() { return <div id="comp-${i}">Component ${i}</div>; }`
    );
    fileCount++;
  }

  // 8 utils
  for (let i = 1; i <= 8; i++) {
    await fs.writeFile(
      path.join(workDir, "src", "utils", `util${i}.js`),
      `export const util${i} = (val) => val * ${i};\nexport const helper${i} = () => "helper ${i}";`
    );
    fileCount++;
  }

  // 6 hooks
  for (let i = 1; i <= 6; i++) {
    await fs.writeFile(
      path.join(workDir, "src", "hooks", `useFeature${i}.js`),
      `import { useState } from "react";\nexport function useFeature${i}() { return useState(${i}); }`
    );
    fileCount++;
  }

  // 6 styles
  for (let i = 1; i <= 6; i++) {
    await fs.writeFile(
      path.join(workDir, "src", "styles", `theme${i}.css`),
      `.theme-${i} { color: #${i}${i}0000; padding: ${i * 4}px; font-family: sans-serif; }`
    );
    fileCount++;
  }

  // 4 services
  for (let i = 1; i <= 4; i++) {
    await fs.writeFile(
      path.join(workDir, "src", "services", `apiService${i}.js`),
      `export async function fetchService${i}() { return fetch("/api/v1/service${i}").then(r => r.json()); }`
    );
    fileCount++;
  }

  // 4 docs
  for (let i = 1; i <= 4; i++) {
    await fs.writeFile(
      path.join(workDir, "docs", `guide${i}.md`),
      `# Guide ${i}\n\nComprehensive documentation chapter ${i} for CodeVault integration testing.`
    );
    fileCount++;
  }

  // Config & public files
  await fs.writeFile(path.join(workDir, "config", "app.config.json"), JSON.stringify({ app: "test", version: "1.0.0" }, null, 2));
  fileCount++;
  await fs.writeFile(path.join(workDir, "config", "database.json"), JSON.stringify({ host: "localhost", port: 5432 }, null, 2));
  fileCount++;
  await fs.writeFile(path.join(workDir, "public", "assets", "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>`);
  fileCount++;
  await fs.writeFile(path.join(workDir, "README.md"), "# 42 Files Project\nRealistic source repository.");
  fileCount++;

  // Add secret file that should be excluded
  await fs.writeFile(path.join(workDir, ".env"), "SECRET_KEY=do_not_stage_this");

  assert.strictEqual(fileCount, 42, `Must have generated exactly 42 files (got ${fileCount})`);
  console.log(`✓ Generated ${fileCount} files in nested directories`);

  // 6. Stage all 42 files
  console.log("\n[TEST 6] Staging 42 files with 'codevault add .'...");
  const staged = await addCommand(["."], { cwd: workDir });
  assert.strictEqual(staged.length, 42, `Must stage exactly 42 files (got ${staged.length})`);
  assert(!staged.includes(".env"), ".env must be excluded");
  console.log(`PASS: Staged ${staged.length} files (.env excluded)`);

  // 7. Commit 42 files
  console.log("\n[TEST 7] Committing 42 files with 'codevault commit -m \"changes\"'...");
  const commitRes = await commitCommand("changes", { cwd: workDir });
  assert.strictEqual(commitRes.files.length, 42);
  console.log(`PASS: Created commit ${commitRes.commitId} with 42 files`);

  // 8. Push 42 files to remote CodeVault backend
  console.log("\n[TEST 8] Pushing 42 files with 'codevault push'...");
  const pushRes = await pushCommand({ cwd: workDir });
  assert.strictEqual(pushRes.branch, "main");
  assert.strictEqual(pushRes.commitsPushed, 1);
  assert.strictEqual(pushRes.head, commitRes.commitId);
  console.log(`PASS: Successfully pushed 42 files to remote (no HTTP 413)!`);

  // 9. Verify website backend reflects all 42 files and commit
  console.log("\n[TEST 9] Verifying website backend reflects files and commit...");
  const filesData = await apiRequest(`/repo/${repoId}/files?branch=main`, {
    token: loginRes.token,
    apiUrl: API_URL,
  });
  assert(filesData.files.length >= 42, `Remote must have at least 42 files (got ${filesData.files.length})`);
  const commitData = await apiRequest(`/repo/${repoId}/commits?branch=main`, {
    token: loginRes.token,
    apiUrl: API_URL,
  });
  assert(commitData.some((c) => c.id === commitRes.commitId), "Remote commits must include our commit");
  console.log(`PASS: Website backend verified with ${filesData.files.length} files and commit in history!`);

  // 10. Verify incremental push (no duplicate/unnecessary push)
  console.log("\n[TEST 10] Verifying incremental push when up to date...");
  const secondPush = await pushCommand({ cwd: workDir });
  assert.strictEqual(secondPush.commitsPushed, 0, "Second push should push 0 commits");
  console.log("PASS: Incremental push verified (0 commits pushed when up to date)");

  // 11. Test oversized file rejection
  console.log("\n[TEST 11] Verifying single file size limit protection (>10MB)...");
  const largeFilePath = path.join(workDir, "large_binary.bin");
  // Create an 11MB file
  const elevenMB = Buffer.alloc(11 * 1024 * 1024, "a");
  await fs.writeFile(largeFilePath, elevenMB);
  let largeFileRejected = false;
  try {
    await addCommand(["large_binary.bin"], { cwd: workDir });
  } catch (err) {
    largeFileRejected = true;
    assert(err.message.includes("10MB limit"), `Expected 10MB limit error, got: ${err.message}`);
  }
  assert(largeFileRejected, "File exceeding 10MB must be rejected by CLI");
  await fs.unlink(largeFilePath).catch(() => {});
  console.log("PASS: Oversized file (>10MB) rejected with clear error");

  // Cleanup test workspace
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

  console.log("\n=== ALL PUSH FAILURE & 42-FILE WORKFLOW TESTS PASSED! ===");
}

runTests().catch((err) => {
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});
