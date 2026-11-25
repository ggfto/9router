import { makeKv } from "../helpers/kvStore.js";

// Model lists fetched from each provider by the model sync, keyed by provider id.
// It is a cache rebuilt by the next run, so it is not part of the DB export.
const kv = makeKv("syncedModels");

export async function getSyncedModels() {
  return await kv.getAll();
}

export async function setSyncedModels(providerId, entry) {
  if (!providerId) return;
  await kv.set(providerId, entry);
}
