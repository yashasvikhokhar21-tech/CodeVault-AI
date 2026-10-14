#!/usr/bin/env node

const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");
const readline = require("readline");

const {
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
} = require("./cli/commands");

function prompt(question, isPassword = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const parser = yargs(hideBin(process.argv))
  .scriptName("codevault")
  .usage("$0 <command> [options]")

  // LOGIN
  .command(
    "login",
    "Log in to your CodeVault account",
    (y) => {
      y.option("email", { type: "string", describe: "User email address" })
        .option("password", { type: "string", describe: "User password" })
        .option("token", { type: "string", describe: "JWT authentication token directly" })
        .option("url", { type: "string", describe: "Backend server URL" });
    },
    async (argv) => {
      try {
        let email = argv.email;
        let password = argv.password;
        let token = argv.token;

        if (!token && !email && process.stdin.isTTY) {
          email = await prompt("Enter CodeVault email: ");
        }
        if (!token && !password && process.stdin.isTTY) {
          password = await prompt("Enter CodeVault password: ", true);
        }

        await loginCommand({ email, password, token, url: argv.url });
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // WHOAMI
  .command(
    "whoami",
    "Display the currently authenticated user in CodeVault CLI",
    () => {},
    async () => {
      try {
        await whoamiCommand();
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // INIT
  .command(
    "init [repo]",
    "Initialize a new CodeVault repository in the current directory",
    (y) => {
      y.positional("repo", { type: "string", describe: "Repository ID or name to link with" })
        .option("repo", { type: "string", describe: "Repository ID or name to link with" })
        .option("url", { type: "string", describe: "Remote backend URL" });
    },
    async (argv) => {
      try {
        const repoArg = argv.repo || argv._[1];
        await initCommand({ repo: repoArg, url: argv.url });
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // LINK
  .command(
    "link <repository>",
    "Link the current project directory to a CodeVault repository",
    (y) => {
      y.positional("repository", { type: "string", describe: "Repository ID, name, or URL" })
        .option("url", { type: "string", describe: "Remote backend URL" });
    },
    async (argv) => {
      try {
        await linkCommand(argv.repository, { url: argv.url });
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // CLONE
  .command(
    "clone <repository> [directory]",
    "Clone a remote CodeVault repository into a local directory",
    (y) => {
      y.positional("repository", { type: "string", describe: "Repository ID, name, or URL" })
        .positional("directory", { type: "string", describe: "Target directory" });
    },
    async (argv) => {
      try {
        await cloneCommand(argv.repository, argv.directory);
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // ADD
  .command(
    "add [files..]",
    "Add file contents to the staging area (use . for all files)",
    (y) => {
      y.positional("files", { type: "string", describe: "Files to add", default: ["."] });
    },
    async (argv) => {
      try {
        const patterns = argv.files && argv.files.length ? argv.files : ["."];
        await addCommand(patterns);
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // COMMIT
  .command(
    "commit",
    "Record staged changes to the repository",
    (y) => {
      y.option("message", {
        alias: "m",
        type: "string",
        describe: "Commit message",
      })
      .option("ai", {
        type: "boolean",
        describe: "Generate commit message using CodeVault AI from staged changes",
        default: false,
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        describe: "Automatically accept the suggested AI commit message without interactive prompt",
        default: false,
      })
      .check((argv) => {
        if (!argv.message && !argv.ai) {
          throw new Error("Missing required argument: specify either -m \"message\" or --ai");
        }
        return true;
      })
      .example('codevault commit -m "feat: implement feature"', 'Record commit with manual message')
      .example('codevault commit --ai', 'Generate AI commit message, preview, and review/accept')
      .example('codevault commit --ai -y', 'Generate AI commit message and commit immediately');
    },
    async (argv) => {
      try {
        await commitCommand(argv.message, { ai: argv.ai, accept: argv.yes });
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // GENERATE-MESSAGE
  .command(
    ["generate-message", "generate-commit-message"],
    "Preview an AI-generated commit message from staged changes without committing",
    {},
    async () => {
      try {
        await generateCommitMessageCommand();
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // PUSH
  .command(
    "push",
    "Push committed changes to the remote CodeVault repository",
    {},
    async () => {
      try {
        await pushCommand();
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // PULL
  .command(
    "pull",
    "Fetch and download changes from the remote CodeVault repository",
    {},
    async () => {
      try {
        await pullCommand();
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // BRANCH
  .command(
    "branch [action] [name]",
    "Manage branches (list, or 'codevault branch create <name>')",
    (y) => {
      y.positional("action", { type: "string", describe: "Sub-action: 'create' or leave empty to list" })
        .positional("name", { type: "string", describe: "Branch name when creating" })
        .option("from", { type: "string", describe: "Source branch (defaults to active branch)" });
    },
    async (argv) => {
      try {
        await branchCommand(argv.action, argv.name, { from: argv.from });
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // CHECKOUT
  .command(
    "checkout <branch>",
    "Switch to a specified branch",
    (y) => {
      y.positional("branch", { type: "string", describe: "Branch name to switch to" });
    },
    async (argv) => {
      try {
        await checkoutCommand(argv.branch);
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // PR
  .command(
    "pr <action>",
    "Manage pull requests ('codevault pr create' or 'codevault pr list')",
    (y) => {
      y.positional("action", { type: "string", choices: ["create", "list"], describe: "PR action" })
        .option("title", { type: "string", describe: "Pull request title" })
        .option("description", { type: "string", describe: "Pull request description" })
        .option("source", { type: "string", describe: "Source branch (defaults to active branch)" })
        .option("target", { type: "string", describe: "Target branch", default: "main" });
    },
    async (argv) => {
      try {
        let title = argv.title;
        if (argv.action === "create" && !title && process.stdin.isTTY) {
          title = await prompt("Enter Pull Request title: ");
        }
        await prCommand(argv.action, {
          title,
          description: argv.description,
          source: argv.source,
          target: argv.target,
        });
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // STATUS
  .command(
    "status",
    "Show the working tree and staging status",
    {},
    async () => {
      try {
        await statusCommand();
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  // LOG
  .command(
    "log",
    "Show commit logs for the current branch",
    {},
    async () => {
      try {
        await logCommand();
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    }
  )

  .example("codevault login", "Authenticate with CodeVault")
  .example("codevault add .", "Stage modified/new files")
  .example("codevault generate-message", "Preview AI-generated commit message from staged changes")
  .example("codevault commit --ai", "Generate commit message with AI, preview, review/edit/accept")
  .example("codevault commit --ai -y", "Generate AI commit message and commit immediately")
  .example('codevault commit -m "feat: added auth"', "Record commit with custom message")
  .example("codevault push", "Push commits to remote CodeVault repository")
  .demandCommand(1, "Please specify a valid command. Run 'codevault --help' for available commands.")
  .help()
  .alias("h", "help")
  .version("1.0.0")
  .alias("v", "version")
  .strict();

if (require.main === module) {
  parser.parse();
}

module.exports = { parser };
