const { GoogleGenAI } = require("@google/genai");

const MAX_CONTEXT_LENGTH = 24000;
const GEMINI_REQUEST_TIMEOUT_MS = 30000;
const GEMINI_MAX_ATTEMPTS = 2;
const MAX_AUTOMATIC_RETRY_DELAY_MS = 5000;
const MAX_CONCURRENT_GEMINI_REQUESTS = 2;
const MAX_QUEUED_GEMINI_REQUESTS = 4;
const TRANSIENT_HTTP_STATUSES = new Set([408, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const ISSUE_ANALYSIS_FIELDS = ["summary", "likelyCause", "suggestedApproach", "priority", "affectedArea", "suggestedFix", "potentialRisks", "testingSuggestions"];
const ISSUE_ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(ISSUE_ANALYSIS_FIELDS.map((field) => [field, { type: "STRING" }])),
  required: ISSUE_ANALYSIS_FIELDS,
  propertyOrdering: ISSUE_ANALYSIS_FIELDS,
};
let activeGeminiRequests = 0;
const waitingGeminiRequests = [];

class AIError extends Error {
  constructor(message, status = 502, { code = "GEMINI_ERROR", retryAfterMs = null, quota = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.quota = quota;
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

function parseProviderPayload(error) {
  const candidates = [error?.response?.data, error?.body, error?.message];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate.error || candidate;
    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed.error || parsed;
      } catch {
        continue;
      }
    }
  }
  return {};
}

function getProviderDetails(error) {
  const payload = parseProviderPayload(error);
  return Array.isArray(payload.details) ? payload.details : error?.errorDetails || error?.details || [];
}

function getQuotaViolation(error) {
  const failure = getProviderDetails(error).find((detail) => detail?.["@type"]?.includes("QuotaFailure"));
  return failure?.violations?.[0] || null;
}

function parseDurationMs(value) {
  if (typeof value !== "string") return null;
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(h|m|s|ms)/g)];
  if (!parts.length) return null;
  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * ({ h: 3600000, m: 60000, s: 1000, ms: 1 }[unit]), 0);
}

function getGeminiRetryDelayMs(error) {
  const retryInfo = getProviderDetails(error).find((detail) => detail?.["@type"]?.includes("RetryInfo"));
  const providerDelay = parseDurationMs(retryInfo?.retryDelay);
  if (providerDelay !== null) return providerDelay;

  const headers = error?.response?.headers || error?.headers;
  const retryAfter = headers?.get?.("retry-after") ?? headers?.["retry-after"];
  if (retryAfter === undefined || retryAfter === null) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function getGeminiStatus(error) {
  return Number(error?.status || error?.response?.status || parseProviderPayload(error).code || 0);
}

function isDailyQuotaError(error) {
  const violation = getQuotaViolation(error);
  const identity = `${violation?.quotaId || ""} ${violation?.quotaMetric || ""}`;
  const payload = parseProviderPayload(error);
  return /perday|requests_per_day|requestsperday|quota.*day/i.test(identity)
    || String(payload.code || "").toLowerCase() === "quota_exceeded"
    || /daily quota/i.test(String(payload.message || error?.message || ""));
}

function isTransientGeminiError(error) {
  if (error instanceof AIError && !["GEMINI_TIMEOUT", "GEMINI_RATE_LIMIT"].includes(error.code)) return false;
  const status = getGeminiStatus(error);
  const code = error?.code || error?.cause?.code;
  if (status === 429) return !isDailyQuotaError(error);
  return TRANSIENT_HTTP_STATUSES.has(status) || TRANSIENT_NETWORK_CODES.has(code) || error?.name === "RequestTimeoutError" || /fetch failed|network error|socket hang up|timed out|timeout/i.test(String(error?.message || ""));
}

function formatWait(retryAfterMs) {
  if (!Number.isFinite(retryAfterMs)) return "";
  const seconds = Math.ceil(retryAfterMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", !hours && !minutes ? `${remainingSeconds}s` : ""].filter(Boolean).join(" ");
}

function classifyGeminiError(error, fallbackModel = "") {
  if (error instanceof AIError) return { code: error.code, status: error.status, retryAfterMs: error.retryAfterMs, quota: error.quota, message: error.message };
  const payload = parseProviderPayload(error);
  const status = getGeminiStatus(error);
  const providerCode = String(payload.status || payload.code || "").toUpperCase();
  const message = String(payload.message || error?.message || "");
  const lowerMessage = message.toLowerCase();
  const retryAfterMs = getGeminiRetryDelayMs(error);
  const violation = getQuotaViolation(error);
  const quota = violation ? {
    metric: violation.quotaMetric || null,
    id: violation.quotaId || null,
    limit: violation.quotaValue || null,
  } : null;
  const model = violation?.quotaDimensions?.model || fallbackModel;

  if (status === 402 || providerCode === "PAYMENT_REQUIRED" || (/billing|prepay|payment|credit balance/.test(lowerMessage) && [400, 403].includes(status))) {
    return { code: "GEMINI_BILLING_REQUIRED", status: 402, retryAfterMs: null, quota, message: "Gemini billing is required or its prepaid balance is empty. Check Google AI Studio Billing and restore an active billing status or balance." };
  }
  if (status === 429 && isDailyQuotaError(error)) {
    const wait = formatWait(retryAfterMs);
    const modelText = model ? ` for ${model}` : "";
    const waitText = wait ? ` Google reports a reset/retry window of about ${wait}.` : " Google did not provide a reset time.";
    return { code: "GEMINI_DAILY_QUOTA", status: 429, retryAfterMs, quota, message: `The Gemini free-tier daily request quota${modelText} is exhausted for this project.${waitText} Requests/day reset at midnight Pacific. Check this project's active limits in Google AI Studio or enable billing; this quota error will not be retried automatically.` };
  }
  if (status === 401 || providerCode === "AUTHENTICATION" || /api key.*(?:invalid|not valid|missing|expired|blocked|reported as leaked|revoked)|invalid (?:API )?key|authentication failed/i.test(message)) {
    return { code: "GEMINI_INVALID_API_KEY", status: 401, retryAfterMs: null, quota: null, message: "Gemini rejected the API key. Check that GEMINI_API_KEY is valid, enabled for the Gemini API, and belongs to the intended Google AI Studio project." };
  }
  if (status === 403 || providerCode === "PERMISSION_DENIED") {
    return { code: "GEMINI_PERMISSION_DENIED", status: 403, retryAfterMs: null, quota, message: "This Google AI Studio project or API key is not permitted to use Gemini. Check project/API access and region availability." };
  }
  if (status === 404 || providerCode === "MODEL_NOT_FOUND" || /model.*(?:not found|not supported|unsupported)|unsupported model/i.test(message)) {
    return { code: "GEMINI_MODEL_UNAVAILABLE", status: 400, retryAfterMs: null, quota: null, message: `The configured Gemini model${model ? ` ${model}` : ""} is unavailable to this API key. Set GEMINI_MODEL to a currently supported model enabled for this project.` };
  }
  if (status === 429 || /resource exhausted|rate.?limit|too many requests/i.test(message)) {
    const wait = formatWait(retryAfterMs);
    return { code: "GEMINI_RATE_LIMIT", status: 429, retryAfterMs, quota, message: `Gemini's short-term rate limit was reached.${wait ? ` Retry after about ${wait}.` : " Wait briefly before trying again."} This request is retried automatically only when the provider's retry window is short.` };
  }
  if (status === 400 || providerCode === "INVALID_ARGUMENT" || providerCode === "FAILED_PRECONDITION") {
    return { code: "GEMINI_REQUEST_REJECTED", status: 400, retryAfterMs: null, quota: null, message: "Gemini rejected the request. Check the model and generation parameters configured for this feature." };
  }
  if (status === 504 || /timed out|timeout|aborted/i.test(message)) {
    return { code: "GEMINI_TIMEOUT", status: 504, retryAfterMs: null, quota: null, message: "The Gemini request timed out. Please try again." };
  }
  if (status === 503 || providerCode === "UNAVAILABLE") {
    const wait = formatWait(retryAfterMs);
    return { code: "GEMINI_OVERLOADED", status: 503, retryAfterMs, quota: null, message: `Google Gemini is temporarily overloaded.${wait ? ` Its retry guidance is about ${wait}.` : " The request was retried once; wait briefly before trying again."}` };
  }
  return { code: "GEMINI_UNAVAILABLE", status: 503, retryAfterMs, quota: null, message: "Gemini is temporarily unavailable. Please try again later." };
}

function normalizeGeminiError(error, model) {
  if (error instanceof AIError) return error;
  const result = classifyGeminiError(error, model);
  return new AIError(result.message, result.status, result);
}

async function withGeminiConcurrency(task) {
  if (activeGeminiRequests >= MAX_CONCURRENT_GEMINI_REQUESTS) {
    if (waitingGeminiRequests.length >= MAX_QUEUED_GEMINI_REQUESTS) {
      throw new AIError("Gemini is busy handling other requests. Please wait briefly and retry.", 503, { code: "GEMINI_BUSY" });
    }
    await new Promise((resolve) => waitingGeminiRequests.push(resolve));
  } else {
    activeGeminiRequests += 1;
  }

  try {
    return await task();
  } finally {
    if (waitingGeminiRequests.length) waitingGeminiRequests.shift()();
    else activeGeminiRequests -= 1;
  }
}

async function askGemini(prompt, { json = false, responseSchema, client = null, timeoutMs = GEMINI_REQUEST_TIMEOUT_MS, maxAttempts = GEMINI_MAX_ATTEMPTS } = {}) {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  if (!client && !geminiApiKey) {
    throw new AIError("Gemini API key is missing. Add GEMINI_API_KEY to the backend environment.", 503);
  }

  if (process.env.CODEVAULT_AI_MOCK_RESPONSE) {
    return process.env.CODEVAULT_AI_MOCK_RESPONSE;
  }

  let ai = client;
  try {
    if (!ai) ai = new GoogleGenAI({ apiKey: geminiApiKey });
  } catch (error) {
    throw normalizeGeminiError(error, geminiModel);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await withGeminiConcurrency(async () => {
        const controller = new AbortController();
        let timeoutId;
        try {
          const request = ai.models.generateContent({
            model: geminiModel,
            contents: prompt,
            config: {
              ...(json ? { responseMimeType: "application/json" } : {}),
              ...(responseSchema ? { responseSchema } : {}),
              abortSignal: controller.signal,
              httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
            },
          });
          const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              controller.abort();
              reject(new AIError("The Gemini request timed out. Please try again.", 504, { code: "GEMINI_TIMEOUT" }));
            }, timeoutMs);
          });
          return await Promise.race([request, timeout]);
        } finally {
          clearTimeout(timeoutId);
        }
      });

      const text =
        response?.text ||
        response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ||
        "";

      if (!text || !text.trim()) {
        throw new AIError("Gemini returned an empty response.", 502);
      }

      return text.trim();
    } catch (error) {
      const retryDelayMs = getGeminiRetryDelayMs(error);
      const canRetry = isTransientGeminiError(error)
        && attempt < maxAttempts
        && (retryDelayMs === null || retryDelayMs <= MAX_AUTOMATIC_RETRY_DELAY_MS);
      if (canRetry) {
        const delay = retryDelayMs ?? Math.min(attempt * 500, MAX_AUTOMATIC_RETRY_DELAY_MS);
        const jitter = Math.floor(Math.random() * 101);
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        continue;
      }
      throw normalizeGeminiError(error, geminiModel);
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
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through to the default AIError below
      }
    }

    throw new AIError("The AI returned an invalid structured response.", 502);
  }
}

async function generateCommitMessage(diff, options) {
  if (!hasStagedChanges(diff)) {
    throw new AIError("No repository changes were found to generate a commit message.", 400);
  }

  return askGemini(`You are a senior software engineer. Generate one concise conventional commit message from the REAL repository changes below. Do not invent changes. Return only the message, no quotes or markdown.\n\nREPOSITORY CHANGES:\n${limitContext(diff)}`, options);
}

async function reviewCode(diff, options = {}) {
  if (!hasStagedChanges(diff)) {
    throw new AIError("No repository changes were found to review.", 400);
  }

  const response = await askGemini(`Review only the supplied REAL repository changes. Return JSON with a "findings" array. Each finding must contain severity (Critical, High, Medium, Low, Info), category, file, line, description, recommendation, and certainty. Use null or "unavailable" when an exact line cannot be determined. Do not invent findings.\n\nREPOSITORY CHANGES:\n${limitContext(diff)}`, { ...options, json: true });

  const result = parseJson(response);
  if (!result || !Array.isArray(result.findings) || result.findings.some((finding) => !finding || typeof finding !== "object" || Array.isArray(finding))) {
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

async function analyzeIssue(issue, repository, options = {}) {
  const response = await askGemini(`Analyze this real issue. Return JSON with exactly these fields: summary, likelyCause, suggestedApproach, priority, affectedArea, suggestedFix, potentialRisks, testingSuggestions. Clearly distinguish facts from hypotheses. Mark uncertain conclusions as possibilities.\n\nREPOSITORY: ${limitContext(repository)}\nISSUE:\n${limitContext(JSON.stringify(issue))}`, { ...options, json: true, responseSchema: ISSUE_ANALYSIS_SCHEMA });

  const result = parseJson(response);
  if (!result || ISSUE_ANALYSIS_FIELDS.some((field) => typeof result[field] !== "string")) {
    throw new AIError("The AI issue analysis format was invalid.", 502);
  }

  return result;
}

function buildChatPrompt(prompt, context = "", history = []) {
  const conversation = Array.isArray(history)
    ? history.slice(-8).filter((message) => ["user", "assistant"].includes(message?.role) && typeof message.content === "string" && message.content.trim())
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim().slice(0, 900)}`)
      .join("\n")
    : "";
  return `You are CodeVault AI, a practical developer assistant. Answer the user's question directly using your general software-development knowledge. Use the supplied repository context when it is relevant, but do not refuse a general question just because the context is empty. Be concise and say when something is uncertain.\n\nCONVERSATION HISTORY:\n${conversation || "No prior messages."}\n\nCONTEXT:\n${limitContext(context).slice(0, 6000) || "No repository-specific context was supplied."}\n\nCURRENT QUESTION:\n${limitContext(prompt).slice(0, 8000)}`;
}

async function chat(prompt, context = "", history = [], options) {
  return askGemini(buildChatPrompt(prompt, context, history), options);
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

async function reviewPullRequestDiff({ title, description, sourceBranch, targetBranch, diff }, options = {}) {
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

  const response = await askGemini(prompt, { ...options, json: true });
  const result = parseJson(response);

  if (!result || Array.isArray(result) || typeof result !== "object" || typeof result.summary !== "string" || !Array.isArray(result.findings) || result.findings.some((finding) => !finding || typeof finding !== "object" || Array.isArray(finding))) {
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
  parseJson,
  getGeminiStatus,
  getGeminiRetryDelayMs,
  getQuotaViolation,
  classifyGeminiError,
  isTransientGeminiError,
  normalizeGeminiError,
  buildChatPrompt,
  reviewPullRequestDiff,
};
