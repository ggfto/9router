import { makeKv } from "../helpers/kvStore.js";

// Provider-level switch, keyed by provider id. Independent from each
// connection's isActive, so turning a provider off and on again keeps the
// per-account choices, and it also covers no-auth providers (no connections).
const kv = makeKv("disabledProviders");

export async function getDisabledProviders() {
  return Object.keys(await kv.getAll());
}

export async function setProviderDisabled(providerId, disabled) {
  if (!providerId) return;
  if (disabled) await kv.set(providerId, true);
  else await kv.remove(providerId);
}
