// P0 GOLDEN: lock buildUrl + buildHeaders for every provider on the OLD code.
// Generate the snapshot once (baseline) → after the refactor, re-running must match exactly.
// Mocking proxyFetch + uuid-heavy executors is NOT needed here because only buildUrl/buildHeaders (pure) are called.
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// Fixed (deterministic) sample credentials — do NOT use Date.now/random.
const API_KEY_CRED = { apiKey: "sk-test-APIKEY", providerSpecificData: {} };
const OAUTH_CRED = { accessToken: "tok-test-ACCESS", providerSpecificData: {} };
const SPECIAL_CRED = {
  apiKey: "sk-test-APIKEY",
  accessToken: "tok-test-ACCESS",
  providerSpecificData: { accountId: "ACC123", region: "sgp", baseUrl: "https://custom.example.com/v1", orgId: "ORG9" },
};

// Providers that need their own executor (buildUrl/buildHeaders not in DefaultExecutor) → skipped in this golden.
// They are locked separately in the 11-provider edge tests / dedicated unit tests.
const SPECIALIZED = new Set([
  "antigravity", "azure", "gemini-cli", "github", "iflow", "qoder", "kiro",
  "codex", "cursor", "vertex", "vertex-partner", "opencode",
  "opencode-go", "grok-web", "perplexity-web", "ollama-local", "commandcode",
  "xiaomi-tokenplan", "mimo-free",
]);

// Per-process / per-request values (kimi's random device name, minimax's session
// UUID) and values that follow the machine running the test (OS, Node, timezone).
const VOLATILE_HEADERS = new Set([
  "x-msh-device-name", "x-mavis-session-id",
  "x-platform", "x-platform-version", "x-msh-device-model", "x-mavis-timezone-offset",
]);
// Headers that carry the app version, which changes on every release.
const APP_VERSION_HEADERS = new Set(["x-client-version", "x-core-version", "x-msh-version"]);

// Sanitize headers: strip tokens + dynamic time fields (kimi X-Msh-Device-Id) so snapshots stay stable.
function sanitize(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (VOLATILE_HEADERS.has(k.toLowerCase())) { out[k] = "<VOLATILE>"; continue; }
    if (APP_VERSION_HEADERS.has(k.toLowerCase())) { out[k] = "<APP_VERSION>"; continue; }
    out[k] = typeof v === "string"
      ? v.replace(/Bearer .+/, "Bearer <TOK>")
          .replace(/sk-test-APIKEY|tok-test-ACCESS/g, "<CRED>")
          // Per-request ids (codebuddy conversation/request headers)
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
          .replace(/kimi-\d{10,}/g, "kimi-<TS>")
          .replace(/9Router\/\d+\.\d+\.\d+/g, "9Router/<APP_VERSION>")
      : v;
  }
  return out;
}

const providerIds = Object.keys(PROVIDERS).filter((p) => !SPECIALIZED.has(p)).sort();

describe("GOLDEN buildUrl (default executor providers)", () => {
  for (const pid of providerIds) {
    it(`${pid} → url (stream + non-stream)`, () => {
      const ex = new DefaultExecutor(pid);
      const cred = PROVIDERS[pid].noAuth ? {} : SPECIAL_CRED;
      const model = "test-model";
      const snap = {
        stream: safe(() => ex.buildUrl(model, true, 0, cred)),
        nonStream: safe(() => ex.buildUrl(model, false, 0, cred)),
      };
      expect(snap).toMatchSnapshot();
    });
  }
});

describe("GOLDEN buildHeaders (default executor providers)", () => {
  for (const pid of providerIds) {
    it(`${pid} → headers (apiKey / oauth)`, () => {
      const ex = new DefaultExecutor(pid);
      const snap = {
        apiKey: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : API_KEY_CRED, true))),
        oauth: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : OAUTH_CRED, true))),
        nonStream: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : API_KEY_CRED, false))),
      };
      expect(snap).toMatchSnapshot();
    });
  }
});

function safe(fn) {
  try { return fn(); } catch (e) { return `THROW: ${e.message}`; }
}
