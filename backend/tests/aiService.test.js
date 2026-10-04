const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AIError,
  askGemini,
  chat,
  generateCommitMessage,
  reviewCode,
  analyzeIssue,
  reviewPullRequestDiff,
  parseJson,
  classifyGeminiError,
  getGeminiRetryDelayMs,
  isTransientGeminiError,
} = require("../services/aiService.js");

function mockClient(generateContent) {
  return { models: { generateContent } };
}

function apiError(status, { code = status, message, statusText = "", details = [] }) {
  const error = new Error(JSON.stringify({ error: { code, message, status: statusText, details } }));
  error.name = "ApiError";
  error.status = status;
  return error;
}

function quotaError({ daily = false, retryDelay = "0.01s" } = {}) {
  const quotaId = daily
    ? "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
    : "GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
  const quotaMetric = daily
    ? "generativelanguage.googleapis.com/generate_content_free_tier_requests"
    : "generativelanguage.googleapis.com/generate_content_free_tier_requests_per_minute";
  return apiError(429, {
    message: daily ? "You exceeded your current quota." : "Quota exceeded for requests per minute.",
    statusText: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaMetric, quotaId, quotaValue: daily ? "20" : "5", quotaDimensions: { model: "gemini-3.8-flash" } }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
    ],
  });
}

test("all five AI service features accept real-shaped Gemini responses", async () => {
  const options = { maxAttempts: 1 };
  const commitDiff = "--- a/index.js\n+++ b/index.js\n+module.exports = true;";
  const jsonClient = (value) => mockClient(async () => ({ text: JSON.stringify(value) }));
  let sdkRetryOptions;

  assert.equal(await chat("hello", "repo context", [], { ...options, client: mockClient(async (request) => { sdkRetryOptions = request.config.httpOptions.retryOptions; return { text: "Hello from Gemini." }; }) }), "Hello from Gemini.");
  assert.equal(sdkRetryOptions.attempts, 1);
  assert.equal(await generateCommitMessage(commitDiff, { ...options, client: mockClient(async () => ({ text: "feat: add export" })) }), "feat: add export");

  const codeReview = await reviewCode(commitDiff, { ...options, client: jsonClient({ findings: [{ severity: "Low", title: "Naming", description: "Consider a clearer name." }] }) });
  assert.equal(codeReview.findings[0].title, "Naming");

  const issueFields = ["summary", "likelyCause", "suggestedApproach", "priority", "affectedArea", "suggestedFix", "potentialRisks", "testingSuggestions"];
  const issueResult = Object.fromEntries(issueFields.map((field) => [field, "analysis text"]));
  let issueSchema;
  const issueClient = mockClient(async (request) => { issueSchema = request.config.responseSchema; return { text: JSON.stringify(issueResult) }; });
  assert.deepEqual(await analyzeIssue({ title: "Failure" }, { name: "repo" }, { ...options, client: issueClient }), issueResult);
  assert.deepEqual(issueSchema.required, issueFields);

  const prReview = await reviewPullRequestDiff({ title: "Update", diff: commitDiff }, { ...options, client: jsonClient({ summary: "Reviewed changes.", findings: [], positiveFindings: [] }) });
  assert.equal(prReview.summary, "Reviewed changes.");
  assert.deepEqual(prReview.findings, []);
});

test("daily free-tier quota exposes quota details and is never retried", async () => {
  const error = quotaError({ daily: true, retryDelay: "67283s" });
  const result = classifyGeminiError(error, "gemini-3.8-flash");
  assert.equal(result.code, "GEMINI_DAILY_QUOTA");
  assert.equal(result.retryAfterMs, 67283000);
  assert.equal(result.quota.limit, "20");
  assert.match(result.message, /daily request quota/i);
  assert.equal(isTransientGeminiError(error), false);

  let calls = 0;
  await assert.rejects(
    () => askGemini("prompt", { maxAttempts: 3, client: mockClient(async () => { calls += 1; throw error; }) }),
    (caught) => caught instanceof AIError && caught.code === "GEMINI_DAILY_QUOTA" && caught.retryAfterMs === 67283000,
  );
  assert.equal(calls, 1);
});

test("short-term 429 honors provider RetryInfo and retries once", async () => {
  let calls = 0;
  const result = await askGemini("prompt", {
    maxAttempts: 2,
    client: mockClient(async () => {
      calls += 1;
      if (calls === 1) throw quotaError({ retryDelay: "0.01s" });
      return { text: "Recovered." };
    }),
  });
  assert.equal(result, "Recovered.");
  assert.equal(calls, 2);
  assert.equal(getGeminiRetryDelayMs({ status: 429, headers: new Headers({ "retry-after": "2" }) }), 2000);

  const ambiguousRateLimit = apiError(429, {
    message: "You exceeded your current quota.",
    statusText: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "requests_per_minute", quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "22s" },
    ],
  });
  assert.equal(classifyGeminiError(ambiguousRateLimit).code, "GEMINI_RATE_LIMIT");
  assert.equal(isTransientGeminiError(ambiguousRateLimit), true);
});

test("invalid API keys, billing restrictions, and unsupported models are not retried", async () => {
  const cases = [
    [apiError(400, { message: "API key not valid. Please pass a valid API key." }), "GEMINI_INVALID_API_KEY", 401],
    [apiError(402, { message: "Prepay credit balance is depleted." }), "GEMINI_BILLING_REQUIRED", 402],
    [apiError(404, { code: "model_not_found", message: "Model not found." }), "GEMINI_MODEL_UNAVAILABLE", 400],
  ];

  for (const [error, code, status] of cases) {
    let calls = 0;
    await assert.rejects(
      () => askGemini("prompt", { maxAttempts: 3, client: mockClient(async () => { calls += 1; throw error; }) }),
      (caught) => caught instanceof AIError && caught.code === code && caught.status === status,
    );
    assert.equal(calls, 1);
  }
  assert.equal(classifyGeminiError(apiError(503, { statusText: "UNAVAILABLE", message: "Model is experiencing high demand." })).code, "GEMINI_OVERLOADED");
});

test("network failures retry once, but malformed and empty model responses do not", async () => {
  let networkCalls = 0;
  const recovered = await askGemini("prompt", {
    maxAttempts: 2,
    client: mockClient(async () => {
      networkCalls += 1;
      if (networkCalls === 1) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      return { text: "Recovered." };
    }),
  });
  assert.equal(recovered, "Recovered.");
  assert.equal(networkCalls, 2);

  assert.throws(() => parseJson("not JSON"), (error) => error instanceof AIError && error.status === 502);
  assert.deepEqual(parseJson("[]"), []);
  let emptyCalls = 0;
  await assert.rejects(
    () => askGemini("prompt", { maxAttempts: 3, client: mockClient(async () => { emptyCalls += 1; return { text: " " }; }) }),
    (error) => error instanceof AIError && error.status === 502,
  );
  assert.equal(emptyCalls, 1);
  await assert.rejects(
    () => reviewCode("real changes", { maxAttempts: 1, client: mockClient(async () => ({ text: "not JSON" })) }),
    (error) => error instanceof AIError && error.status === 502,
  );
  await assert.rejects(
    () => reviewCode("real changes", { maxAttempts: 1, client: mockClient(async () => ({ text: "[]" })) }),
    (error) => error instanceof AIError && error.status === 502,
  );
  await assert.rejects(
    () => reviewPullRequestDiff({ diff: "real changes" }, { maxAttempts: 1, client: mockClient(async () => ({ text: JSON.stringify({ findings: [] }) })) }),
    (error) => error instanceof AIError && error.status === 502,
  );
});

test("SDK request timeout cancels the request and surfaces a 504", async () => {
  await assert.rejects(
    () => askGemini("prompt", {
      maxAttempts: 1,
      timeoutMs: 5,
      client: mockClient(({ config }) => new Promise((resolve, reject) => {
        config.abortSignal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })),
    }),
    (error) => error instanceof AIError && error.code === "GEMINI_TIMEOUT" && error.status === 504,
  );
});

test("concurrent calls are capped without rejecting a normal burst", async () => {
  let active = 0;
  let peak = 0;
  const client = mockClient(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { text: "ok" };
  });
  const results = await Promise.all(Array.from({ length: 6 }, () => askGemini("prompt", { maxAttempts: 1, client })));
  assert.equal(results.length, 6);
  assert(peak <= 2, `Expected at most 2 active calls, got ${peak}`);
});