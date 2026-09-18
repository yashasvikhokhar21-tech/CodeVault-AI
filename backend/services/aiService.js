const { GoogleGenAI } = require("@google/genai");

const MAX_CONTEXT_LENGTH = 24000;

class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function limitContext(value) {
  const text = String(value || "");
  return text.length > MAX_CONTEXT_LENGTH
    ? `${text.slice(0, MAX_CONTEXT_LENGTH)}\n\n[Context limited to ${MAX_CONTEXT_LENGTH} characters.]`
    : text;
}

function hasStagedChanges(diff) {
  const text = String(diff || "");
  return !/No staged files were found|no staged changes/i.test(text);
}

async function askGemini(prompt, { json = false } = {}) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!geminiApiKey) {
    throw new AIError("Gemini API key is missing. Add GEMINI_API_KEY to the backend environment.", 500);
  }

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const request = () => ai.models.generateContent({
        model: geminiModel,
        contents: prompt,
        config: json ? { responseMimeType: "application/json" } : undefined,
      });

      const response = await Promise.race([
        request(),
        new Promise((_, reject) => setTimeout(() => reject(new AIError("The AI request timed out.", 504)), 120000)),
      ]);

      const text =
        response?.text ||
        response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ||
        "";

      if (!text || !text.trim()) {
        throw new AIError("Gemini returned an empty response.", 502);
      }

      return text.trim();
    } catch (error) {
      if (error instanceof AIError && error.status !== 503 && error.status !== 429) {
        throw error;
      }
      const isRateLimit = error?.status === 429;
      const isAuthError = error?.status === 400 || /api key|authentication|permission|unauthorized/i.test(String(error?.message || ""));
      if (isAuthError) {
        throw new AIError("Gemini authentication failed. Check the backend GEMINI_API_KEY.", 401);
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }

      if (isRateLimit) {
        throw new AIError("Gemini rate limit exceeded. Please try again in a moment.", 429);
      }
      throw new AIError("Gemini is unavailable right now. Please try again later.", 503);
    }
  }
}

function parseJson(response) {
  const cleaned = String(response || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AIError("The AI returned an invalid structured response.", 502);
  }
}

async function generateCommitMessage(diff) {
  if (!hasStagedChanges(diff)) {
    throw new AIError("No staged changes found. Please add or stage files before generating a commit message.", 400);
  }

  return askGemini(`You are a senior software engineer. Generate one concise conventional commit message from the REAL staged changes below. Do not invent changes. Return only the message, no quotes or markdown.\n\nSTAGED CHANGES:\n${limitContext(diff)}`);
}

async function reviewCode(diff) {
  if (!hasStagedChanges(diff)) {
    throw new AIError("No staged changes found. Please add or stage files before reviewing your code.", 400);
  }

  const response = await askGemini(`Review only the supplied REAL code changes. Return JSON with a "findings" array. Each finding must contain severity (Critical, High, Medium, Low, Info), category, file, line, description, recommendation, and certainty. Use null or "unavailable" when an exact line cannot be determined. Do not invent findings.\n\nCHANGES:\n${limitContext(diff)}`, { json: true });

  const result = parseJson(response);
  if (!result || !Array.isArray(result.findings)) {
    throw new AIError("The AI review format was invalid.", 502);
  }

  return {
    findings: result.findings.map((finding) => ({
      ...finding,
      severity: finding.severity || "Info",
      line: finding.line ?? null,
      certainty: finding.certainty || "potential concern",
    })),
  };
}

async function analyzeIssue(issue, repository) {
  const response = await askGemini(`Analyze this real issue. Return JSON with exactly these fields: summary, likelyCause, suggestedApproach, priority, affectedArea, suggestedFix, potentialRisks, testingSuggestions. Clearly distinguish facts from hypotheses. Mark uncertain conclusions as possibilities.\n\nREPOSITORY: ${limitContext(repository)}\nISSUE:\n${limitContext(JSON.stringify(issue))}`, { json: true });

  const result = parseJson(response);
  const fields = ["summary", "likelyCause", "suggestedApproach", "priority", "affectedArea", "suggestedFix", "potentialRisks", "testingSuggestions"];
  if (!result || fields.some((field) => typeof result[field] !== "string")) {
    throw new AIError("The AI issue analysis format was invalid.", 502);
  }

  return result;
}

async function chat(prompt, context = "") {
  return askGemini(`You are CodeVault AI, a practical developer assistant. Answer the user's question directly using your general software-development knowledge. Use the supplied repository context when it is relevant, but do not refuse a general question just because the context is empty. Be concise and say when something is uncertain.\n\nCONTEXT:\n${limitContext(context) || "No repository-specific context was supplied."}\n\nQUESTION:\n${limitContext(prompt)}`);
}

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

async function reviewPullRequestDiff({ title, description, sourceBranch, targetBranch, diff }) {
  if (!diff || !diff.trim()) {
    throw new AIError("No changed code found in this pull request to review.", 400);
  }

  const prompt = `You are a principal software engineer and security auditor conducting an advisory code review for a Pull Request.

PULL REQUEST METADATA:
Title: ${title || "Untitled"}
Description: ${description || "None"}
Branch: ${sourceBranch || "source"} -> ${targetBranch || "target"}

INSTRUCTIONS:
1. Review ONLY the provided changes introduced in the pull request diff. Do NOT review unchanged code unless the changed code directly depends on it.
2. Review for these categories:
   - Correctness / bugs
   - Security vulnerabilities
   - Error handling
   - Performance problems
   - Code quality / maintainability
   - Potential edge cases
   - API/backend issues where relevant
   - Frontend issues where relevant
3. Do NOT invent files, line numbers, behavior, or vulnerabilities. Only report an issue when there is concrete evidence in the supplied diff.
4. Distinguish definite problems from potential concerns. Explain why each finding matters and provide a practical fix/suggestion.
5. Severity MUST be one of these exact values: "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO".
   - CRITICAL: Severe security flaws, data loss, fatal runtime crash.
   - HIGH: Major bugs, unhandled edge cases breaking core functionality, security concerns.
   - MEDIUM: Robustness, potential regressions, missing error handling, performance concerns.
   - LOW: Code cleanliness, minor maintainability, style discrepancies.
   - INFO: Suggestions, minor observations, or non-blocking enhancements.
6. Do NOT provide an overall numeric score (e.g. do not say "8/10").
7. Highlight genuine positive findings where good engineering practices, testing, or security precautions were implemented. Do not praise unnecessarily.
8. Respond ONLY with a valid JSON object matching this schema:
{
  "summary": "Concise overview of what this PR changes and the overall review assessment.",
  "findings": [
    {
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO",
      "file": "path/to/file",
      "line": 42,
      "title": "Short descriptive title of the issue",
      "description": "Clear explanation of the problem, evidence in the diff, and why it matters.",
      "suggestion": "Practical and actionable code fix or recommendation."
    }
  ],
  "positiveFindings": [
    "Description of a well-implemented pattern or practice observed in the changes."
  ]
}

PULL REQUEST DIFF:
${diff}`;

  const response = await askGemini(prompt, { json: true });
  const result = parseJson(response);

  if (!result || typeof result !== "object") {
    throw new AIError("The AI review format was invalid.", 502);
  }

  const validSeverities = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
  const mapSeverity = (val) => {
    const upper = String(val || "").toUpperCase().trim();
    if (validSeverities.has(upper)) return upper;
    if (upper === "WARNING") return "MEDIUM";
    if (upper === "ERROR") return "HIGH";
    if (upper === "SUGGESTION" || upper === "NOTE") return "INFO";
    return "INFO";
  };

  const findings = Array.isArray(result.findings)
    ? result.findings.map((finding) => {
        let line = null;
        if (typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0) {
          line = finding.line;
        } else if (typeof finding.line === "string" && /^\d+$/.test(finding.line.trim())) {
          line = parseInt(finding.line.trim(), 10);
        }
        return {
          severity: mapSeverity(finding.severity),
          file: typeof finding.file === "string" ? finding.file.trim() : null,
          line,
          title: typeof finding.title === "string" && finding.title.trim() ? finding.title.trim() : "Review Finding",
          description: typeof finding.description === "string" ? finding.description.trim() : "",
          suggestion: typeof finding.suggestion === "string" ? finding.suggestion.trim() : "",
        };
      })
    : [];

  const positiveFindings = Array.isArray(result.positiveFindings)
    ? result.positiveFindings
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    : [];

  return {
    summary: typeof result.summary === "string" && result.summary.trim() ? result.summary.trim() : "AI code review completed for the pull request.",
    findings,
    positiveFindings,
  };
}

module.exports = {
  askGemini,
  generateCommitMessage,
  reviewCode,
  analyzeIssue,
  chat,
  limitContext,
  AIError,
  hasStagedChanges,
  redactSecrets,
  reviewPullRequestDiff,
};
