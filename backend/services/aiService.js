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
    if (error instanceof AIError) throw error;
    if (error?.status === 429) throw new AIError("Gemini rate limit exceeded. Please try again in a moment.", 429);
    if (error?.status === 400 || /api key|authentication|permission|unauthorized/i.test(String(error?.message || ""))) {
      throw new AIError("Gemini authentication failed. Check the backend GEMINI_API_KEY.", 401);
    }
    throw new AIError("Gemini is unavailable right now. Please try again later.", 503);
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

module.exports = { askGemini, generateCommitMessage, reviewCode, analyzeIssue, chat, limitContext, AIError, hasStagedChanges };
