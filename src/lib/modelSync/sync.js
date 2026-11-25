// Asks every enabled provider for its current model list and caches the answer.
// Not to be confused with lib/modelCatalog, which refreshes capabilities
// (context window, vision...) from models.dev.
//
// A provider that fails, answers empty or can only offer the static fallback
// keeps its previous cache: a bad run never removes models.

import { getProviderConnections, getSettings } from "@/lib/db/index.js";
import { getDisabledProviders } from "@/lib/disabledProvidersDb";
import { getSyncedModels, setSyncedModels } from "@/lib/syncedModelsDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { normalizeSyncedModels } from "./normalize.js";

const CONCURRENCY = 4;
const PROVIDER_TIMEOUT_MS = 20000;
const MAX_ERROR_LENGTH = 200;
// Model listing for these honors the connection's proxy; the rest connect
// directly, which must not happen for an account bound to a proxy.
const PROXY_AWARE_PROVIDERS = new Set(["grok-cli"]);

// Next bundles instrumentation and API routes separately, so shared state has
// to live on globalThis.
const state = (globalThis.__9routerModelSync ??= { current: null, lastRun: null });

export function getModelSyncRunState() {
  return { running: !!state.current, lastRun: state.lastRun };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function usesProxy(connection) {
  const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
  return (proxy.connectionProxyEnabled === true && !!proxy.connectionProxyUrl)
    || !!proxy.vercelRelayUrl
    || proxy.strictProxy === true;
}

// Same listing logic the dashboard's "import models" button uses.
async function fetchConnectionModels(connection) {
  if (connection.refreshToken) {
    // Refresh through the shared path first: rotating refresh tokens must not
    // be spent by a second, uncoordinated refresh.
    const { checkAndRefreshToken } = await import("@/sse/services/tokenRefresh.js");
    await checkAndRefreshToken(connection.provider, { ...connection, connectionId: connection.id });
  }
  const { GET } = await import("@/app/api/providers/[id]/models/route.js");
  const response = await GET(
    new Request(`http://localhost/api/providers/${encodeURIComponent(connection.id)}/models`),
    { params: Promise.resolve({ id: connection.id }) },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  if (data.warning) throw new Error(data.warning);
  return data.models;
}

async function syncProvider(providerId, connections, fetchModels) {
  let lastError = "No models returned";
  let skippedForProxy = 0;

  // Accounts in priority order; the first one that answers wins.
  for (const connection of connections) {
    try {
      if (!PROXY_AWARE_PROVIDERS.has(providerId) && await usesProxy(connection)) {
        skippedForProxy += 1;
        continue;
      }
      const models = normalizeSyncedModels(
        providerId,
        await withTimeout(fetchModels(connection), PROVIDER_TIMEOUT_MS),
      );
      if (models.length) return { providerId, status: "ok", models };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }

  if (skippedForProxy === connections.length) {
    return { providerId, status: "skipped", error: "All accounts use a proxy, which model listing does not support" };
  }
  if (/does not support models listing/i.test(lastError)) {
    return { providerId, status: "skipped", error: "Provider has no model listing" };
  }
  return { providerId, status: "error", error: lastError.slice(0, MAX_ERROR_LENGTH) };
}

async function runSync(fetchModels) {
  const startedAt = Date.now();
  const disabled = new Set(await getDisabledProviders());
  const byProvider = new Map();
  for (const connection of await getProviderConnections({ isActive: true })) {
    if (disabled.has(connection.provider)) continue;
    if (!byProvider.has(connection.provider)) byProvider.set(connection.provider, []);
    byProvider.get(connection.provider).push(connection);
  }

  const cache = await getSyncedModels();
  const queue = [...byProvider.entries()];
  const results = [];

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [providerId, connections] = next;
      const result = await syncProvider(providerId, connections, fetchModels);
      if (result.status !== "ok") {
        results.push(result);
        continue;
      }
      const previous = new Set((cache[providerId]?.models || []).map((m) => m.id));
      const current = new Set(result.models.map((m) => m.id));
      await setSyncedModels(providerId, { models: result.models, syncedAt: Date.now() });
      results.push({
        providerId,
        status: "ok",
        total: current.size,
        added: [...current].filter((id) => !previous.has(id)).length,
        removed: [...previous].filter((id) => !current.has(id)).length,
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  results.sort((a, b) => a.providerId.localeCompare(b.providerId));
  const summary = { startedAt, finishedAt: Date.now(), results };
  state.lastRun = summary;
  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`[modelSync] ${ok}/${results.length} providers updated`);
  return summary;
}

/** Run one sync; concurrent callers share the run already in flight. */
export function syncProviderModels({ fetchModels = fetchConnectionModels } = {}) {
  state.current ??= runSync(fetchModels).finally(() => { state.current = null; });
  return state.current;
}

export async function getModelSyncSettings() {
  const settings = await getSettings();
  return { enabled: settings.modelSyncEnabled === true, cron: settings.modelSyncCron };
}
