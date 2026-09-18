const assert = require("assert");

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

const sample = `
  const googleKey = "AIzaSyD-7V_x9bX9u0V-EXAMPLE_API_KEY_123";
  const awsKey = "AKIAIOSFODNN7EXAMPLE";
  const ghToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
  const dbPassword = "SuperSecretPassword123!";
  password: "SuperSecretPassword123!";
  -----BEGIN RSA PRIVATE KEY-----
  MIIEowIBAAKCAQEA0Y1EXAMPLEPRIVATEKEYDATA...
  -----END RSA PRIVATE KEY-----
`;

const res = redactSecrets(sample);
console.log(res);

assert(!res.includes("AIzaSyD-7V_x9bX9u0V-EXAMPLE_API_KEY_123"));
assert(!res.includes("AKIAIOSFODNN7EXAMPLE"));
assert(!res.includes("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
assert(!res.includes("SuperSecretPassword123!"));
assert(!res.includes("MIIEowIBAAKCAQEA0Y1EXAMPLEPRIVATEKEYDATA"));
assert(res.includes("[REDACTED_API_KEY]"));
assert(res.includes("[REDACTED_AWS_KEY]"));
assert(res.includes("[REDACTED_GITHUB_TOKEN]"));
assert(res.includes("[REDACTED_PRIVATE_KEY]"));
assert(res.includes("[REDACTED]"));
console.log("All redact assertions passed!");
