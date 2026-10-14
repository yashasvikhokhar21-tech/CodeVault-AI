# CodeVault CLI — VS Code Terminal Integration Guide

The CodeVault CLI provides full terminal integration for **CodeVault-AI**, allowing developers to manage repositories, branch workflows, commits, remote pushes/pulls, and pull requests directly from the VS Code terminal on Windows PowerShell.

---

## 1. Setup & Installation

The CLI executable is linked directly into your Node environment and provides a global `codevault` command, as well as PowerShell (`codevault.ps1`) and CMD (`codevault.cmd`) wrappers in the workspace.

### Enable the CLI globally:
From the `backend` directory, run:
```bash
npm link
```

Verify that the CLI is accessible in your PowerShell terminal:
```powershell
codevault --help
```

---

## 2. Authentication & Configuration

The CLI securely stores your JWT session token and configuration without exposing secrets:
- **Global Configuration & Auth**: `~/.codevault/config.json` stores your active JWT token, username, and default API endpoint (`http://localhost:3002`).
- **Local Project Configuration**: `.hiddenGit/config.json` in each repository stores the linked CodeVault `repositoryId`, `repoName`, and remote tracking branches.
- **Excluded Files**: The CLI automatically prevents secrets and bulky directories (`.env`, `.env.*`, `node_modules/`, `dist/`, `build/`, `.hiddenGit/`, `.git/`, `*.pem`, `*.key`) from ever being staged or pushed.

---

## 3. Supported Commands & Usage

### 3.1. Authentication
```powershell
# Interactive login (prompts for email and password)
codevault login

# Non-interactive / scripted login
codevault login --email user@example.com --password "MySecretPass!" --url http://localhost:3002
```

### 3.2. Initialize or Link a Repository
```powershell
# Initialize a local project and link to an existing CodeVault remote repo (by ID or Name)
codevault init <repositoryIdOrName>
# OR
codevault init --repo <repositoryIdOrName>

# Link an already initialized repository to a CodeVault remote repo
codevault link <repositoryIdOrName>

# Initialize an empty local project (can be linked later)
codevault init
```

### 3.3. Clone a Repository
```powershell
# Clone an existing CodeVault repository by ID or Name
codevault clone <repositoryIdOrName> [targetDirectory]
```
Downloads repository content, reconstructs snapshots into `.hiddenGit`, sets up branch tracking, and checks out files into the target folder.

### 3.4. Staging Files
```powershell
# Stage all files in the project (respects exclusion list)
codevault add .

# Stage specific files or directories
codevault add src/index.js
```

### 3.5. Commit Changes & AI Generation
```powershell
# 1. Standard commit with manual message
codevault commit -m "feat: add responsive navbar component"

# 2. Preview an AI-generated commit message without committing
codevault generate-message
# Alias:
codevault generate-commit-message

# 3. Generate AI commit message with interactive review (Accept / Edit / Abort)
codevault commit --ai
# Terminal prompt:
#   Actions:
#     [c] Accept and commit with suggested message (default)
#     [e] Edit message before committing
#     [a] Abort commit
#   Choose action [c/e/a] (default: c):

# 4. Non-interactive AI commit (immediately accept and commit)
codevault commit --ai -y
# OR
codevault commit --ai --yes
```

#### Windows PowerShell AI Commit Workflow:
```powershell
# Stage changes
codevault add .

# Generate AI message and review
codevault commit --ai

# Push to CodeVault remote
codevault push
```

#### AI Privacy & Security:
- Automatically analyzes only the actual staged diff (added, modified, and deleted files).
- Excludes `.env`, credential files (`.pem`, `.key`, `id_rsa`), and binary assets.
- Automatically redacts API keys, JWTs, and passwords from the prompt before sending to the backend AI service.
- Safely caps oversized diffs to 24,000 characters with truncation indicators.


### 3.6. View Status & History
```powershell
# Show active branch, linked repository, staged changes, and modified files
codevault status

# View commit history for the current branch
codevault log
```

### 3.7. Push to Remote
```powershell
# Push committed snapshots and update website repository files and commit history
codevault push
```
Updates remote snapshots in `remoteRepo/`, writes `commit.json`, updates `Repository.branches` head/commits in MongoDB, and updates `Repository.content`.

### 3.8. Pull from Remote
```powershell
# Pull latest files and commit history for the active branch from the website
codevault pull
```

### 3.9. Branch Management
```powershell
# List all local and remote branches (highlights active branch)
codevault branch

# Create a new branch originating from the current branch
codevault branch create feature-login

# Create a branch originating from a specific branch
codevault branch create feature-login --from main

# Switch to a branch
codevault checkout feature-login
```

### 3.10. Pull Requests
```powershell
# Create a pull request to merge your branch into main
codevault pr create --title "Feature: Authentication" --description "Adds JWT auth" --source feature-login --target main

# List all pull requests and their review statuses
codevault pr list
```

---

## 4. Running the Automated Test Suite

To verify all 14 CLI commands and backend integrations end-to-end:
```bash
node backend/tests/cli_workflow.test.js
```
The test suite validates:
1. `login` authentication and token persistence.
2. `init` with repository mapping.
3. Clean `status` detection.
4. Automatic exclusion of `.env` and `node_modules`.
5. `add .` staging.
6. `commit -m` snapshot recording.
7. `log` history output.
8. `push` remote sync.
9. Website file tree and commit verification.
10. `branch create` on remote MongoDB.
11. `branch` listing.
12. `checkout` switching branch.
13. Committing and pushing to the new branch.
14. `pr create` pull request generation.
15. `pr list` query and status display.
16. `clone` remote retrieval.
17. `pull` synchronization.

To verify the AI Commit Message Generation pipeline specifically:
```bash
node backend/tests/cli_ai_commit.test.js
```
The test suite validates:
1. `codevault generate-message` previews suggestions without committing.
2. Interactive commit with Abort (`[a]`) cleanly cancels without committing.
3. Interactive commit with Edit (`[e]`) records the user-edited message.
4. Interactive commit with Accept (`[c]`) and automated accept (`-y`) record commits.
5. Staged additions, modifications, and deletions properly represented in unified diff.
6. Empty staging and unlinked repository detection with actionable errors.
7. Secrets redaction and `.env` exclusion.
8. Live Gemini error handling (quota exhaustion and network errors).
9. Push sync of AI-generated commits to the remote CodeVault server.
