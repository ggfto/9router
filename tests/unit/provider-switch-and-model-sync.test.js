/**
 * Provider/model switches and the scheduled provider model sync, against a real
 * SQLite database in a temporary DATA_DIR.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-switch-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;

let db, gate, auth, sync, cron, normalize, modelsRoute, providerSwitchRoute;

beforeAll(async () => {
  db = await import("@/lib/db/index.js");
  gate = await import("@/sse/services/disabledModels.js");
  auth = await import("@/sse/services/auth.js");
  sync = await import("@/lib/modelSync/sync.js");
  cron = await import("@/lib/modelSync/cron.js");
  normalize = await import("@/lib/modelSync/normalize.js");
  modelsRoute = await import("@/app/api/v1/models/route.js");
  providerSwitchRoute = await import("@/app/api/providers/disabled/route.js");
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows keeps the db open */ }
});

const listIds = async () => (await modelsRoute.buildModelsList(["llm"], { skipDynamicFetch: true })).map((m) => m.id);

const toggleProvider = (providerId, disabled) => providerSwitchRoute.POST(new Request("http://localhost/api/providers/disabled", {
  method: "POST",
  body: JSON.stringify({ providerId, disabled }),
}));

describe("provider switch", () => {
  let first, second;

  beforeAll(async () => {
    first = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "a", apiKey: "sk-a" });
    second = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "b", apiKey: "sk-b", isActive: false });
  });

  it("blocks routing, credentials, combos and listing, by id or alias", async () => {
    await toggleProvider("openai", true);
    await expect(gate.getDisabledReason("openai", "gpt-4o")).resolves.toMatch(/Provider "openai" is disabled/);
    await expect(auth.getProviderCredentials("openai")).resolves.toBeNull();
    await expect(gate.filterDisabledModels(["openai/gpt-4o", "anthropic/claude-sonnet-4"]))
      .resolves.toEqual(["anthropic/claude-sonnet-4"]);
    expect((await listIds()).filter((id) => id.startsWith("openai/"))).toEqual([]);
  });

  it("does not fall back to the whole static catalog when everything is off", async () => {
    const owners = new Set((await listIds()).map((id) => id.split("/")[0]));
    expect(owners.has("anthropic")).toBe(false);
    expect(owners.has("cc")).toBe(false);
  });

  it("keeps each account's own switch across off and on", async () => {
    await toggleProvider("openai", false);
    const states = Object.fromEntries((await db.getProviderConnections({ provider: "openai" })).map((c) => [c.id, c.isActive]));
    expect(states[first.id]).toBe(true);
    expect(states[second.id]).toBe(false);
  });

  it("brings the accounts back when all of them were off", async () => {
    await db.updateProviderConnection(first.id, { isActive: false });
    await toggleProvider("openai", false);
    const connections = await db.getProviderConnections({ provider: "openai" });
    expect(connections.every((c) => c.isActive)).toBe(true);
  });

  it("works for providers without any account", async () => {
    const before = await listIds();
    expect(before.some((id) => id.startsWith("oc/"))).toBe(true);
    await toggleProvider("opencode", true);
    expect((await listIds()).some((id) => id.startsWith("oc/"))).toBe(false);
    await expect(auth.getProviderCredentials("oc")).resolves.toBeNull();
    await toggleProvider("opencode", false);
  });

  it("rejects a malformed body", async () => {
    expect((await toggleProvider("openai", "yes")).status).toBe(400);
  });
});

describe("model switch", () => {
  it("cannot be bypassed with a thinking suffix", async () => {
    await db.disableModels("openai", ["gpt-5"]);
    await expect(gate.getDisabledReason("openai", "gpt-5(high)")).resolves.toBeTruthy();
    await expect(gate.getDisabledReason("openai", "gpt-5-mini")).resolves.toBeNull();
    await db.enableModels("openai", ["gpt-5"]);
  });

  it("survives export and import, and older backups leave switches alone", async () => {
    await db.disableModels("openai", ["gpt-4o"]);
    await db.setProviderDisabled("groq", true);
    const backup = await db.exportDb();
    expect(backup.disabledModels.openai).toEqual(["gpt-4o"]);
    expect(backup.disabledProviders).toEqual(["groq"]);

    const { disabledModels, disabledProviders, ...older } = backup;
    await db.importDb(older);
    await expect(db.getDisabledProviders()).resolves.toEqual(["groq"]);

    await db.importDb({ ...backup, disabledModels: {}, disabledProviders: [] });
    await expect(db.getDisabledProviders()).resolves.toEqual([]);
    await expect(db.getDisabledModels()).resolves.toEqual({});
  });
});

describe("provider model sync", () => {
  const fetchOnly = (answers) => async (connection) => {
    const answer = answers[connection.provider];
    if (answer instanceof Error) throw answer;
    return answer;
  };

  it("caches new models and lists them next to the built-in ones", async () => {
    const run = await sync.syncProviderModels({ fetchModels: fetchOnly({ openai: [{ id: "gpt-brand-new" }] }) });
    expect(run.results).toContainEqual({ providerId: "openai", status: "ok", total: 1, added: 1, removed: 0 });
    expect(await listIds()).toContain("openai/gpt-brand-new");
  });

  it("keeps the previous list when the provider fails or answers empty", async () => {
    for (const answer of [new Error("HTTP 500"), []]) {
      const run = await sync.syncProviderModels({ fetchModels: fetchOnly({ openai: answer }) });
      expect(run.results[0].status).toBe("error");
      expect((await db.getSyncedModels()).openai.models.map((m) => m.id)).toEqual(["gpt-brand-new"]);
    }
  });

  it("skips disabled providers", async () => {
    await db.setProviderDisabled("openai", true);
    let calls = 0;
    await sync.syncProviderModels({ fetchModels: async () => { calls += 1; return []; } });
    expect(calls).toBe(0);
    await db.setProviderDisabled("openai", false);
  });

  it("never lists models directly for an account bound to a proxy", async () => {
    await db.createProviderConnection({
      provider: "groq", authType: "apikey", name: "proxied", apiKey: "gsk",
      providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:7890" },
    });
    const asked = [];
    const run = await sync.syncProviderModels({
      fetchModels: async (c) => { asked.push(c.provider); return [{ id: "m" }]; },
    });
    expect(asked).not.toContain("groq");
    expect(run.results.find((r) => r.providerId === "groq").status).toBe("skipped");
  });

  it("normalizes and filters upstream ids", () => {
    expect(normalize.normalizeSyncedModels("gemini", [
      { name: "models/gemini-x", displayName: "Gemini X" },
      { name: "models/text-embedding-1", supportedGenerationMethods: ["embedContent"] },
      { id: "has space" }, { id: 42 }, null,
    ])).toEqual([
      { id: "gemini-x", name: "Gemini X", kind: "llm" },
      { id: "text-embedding-1", name: "text-embedding-1", kind: "embedding" },
    ]);
    expect(normalize.normalizeSyncedModels("qoder", [{ id: "qoder/auto" }])[0].id).toBe("auto");
    expect(normalize.normalizeSyncedModels("openrouter", [{ id: "openrouter/auto" }])[0].id).toBe("openrouter/auto");
  });
});

describe("cron schedule", () => {
  const next = (expression, from) => cron.nextCronRun(expression, from);
  const from = new Date(2026, 10, 25, 10, 15, 30); // Wednesday, local time

  it("finds the next slot", () => {
    expect(next("0 */6 * * *", from)).toEqual(new Date(2026, 10, 25, 12, 0));
    expect(next("*/10 * * * *", from)).toEqual(new Date(2026, 10, 25, 10, 20));
    expect(next("30 4 * * *", from)).toEqual(new Date(2026, 10, 26, 4, 30));
    expect(next("0 4 * * 7", from)).toEqual(new Date(2026, 10, 29, 4, 0));
    expect(next("@monthly", from)).toEqual(new Date(2026, 11, 1, 0, 0));
    expect(next("15 10 * * *", from)).toEqual(new Date(2026, 10, 26, 10, 15));
  });

  it("matches either day field when both are restricted", () => {
    expect(next("0 0 1 * 5", from)).toEqual(new Date(2026, 10, 27, 0, 0));
  });

  it("rejects bad or impossible expressions", () => {
    for (const bad of ["", "* * * *", "60 * * * *", "*/0 * * * *", "a * * * *", "5-1 * * * *", "0 0 31 2 *"]) {
      expect(cron.getCronError(bad), bad).toBeTruthy();
    }
    expect(cron.getCronError("0 0 29 2 *")).toBeNull();
  });
});
