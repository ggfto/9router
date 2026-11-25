// Runtime enforcement of the dashboard's provider and model switches.
//
// Every route that reaches an upstream goes through getDisabledReason (or
// filterDisabledModels for combo lists), so turning something off in the
// dashboard stops traffic to it, not just its listing.
//
// Disabled model ids are stored keyed by the provider's storage alias (built-in
// providers) or by the raw providerId (openai/anthropic-compatible nodes), so
// every lookup has to try both — the same rule ModelSelectModal uses.
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getDisabledProviders } from "@/lib/disabledProvidersDb";
import { getProviderAlias, resolveProviderId } from "@/shared/constants/providers.js";
import { stripThinkingSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { getModelInfo } from "./model.js";
import * as log from "../utils/logger.js";

/**
 * Read the full disabled map. Fails open — a DB hiccup must never take routing
 * down, it just means nothing is treated as disabled for that request.
 * @returns {Promise<Record<string, string[]>>}
 */
export async function getDisabledModelMap() {
  try {
    return await getDisabledModels();
  } catch (error) {
    log.warn("MODELS", `Could not read disabled models: ${error.message}`);
    return {};
  }
}

/** Disabled provider ids as a Set. Fails open like getDisabledModelMap. */
export async function getDisabledProviderSet() {
  try {
    return new Set(await getDisabledProviders());
  } catch (error) {
    log.warn("MODELS", `Could not read disabled providers: ${error.message}`);
    return new Set();
  }
}

export async function isProviderDisabled(provider) {
  if (!provider) return false;
  return (await getDisabledProviderSet()).has(resolveProviderId(provider));
}

/**
 * Check a resolved provider/model pair against an already-loaded map.
 */
export function isDisabledInMap(disabledMap, provider, model) {
  if (!disabledMap || !provider || !model) return false;
  const ids = [
    ...(disabledMap[getProviderAlias(provider)] || []),
    ...(disabledMap[provider] || []),
  ];
  // "model(high)" reaches the same upstream model as "model", so the thinking
  // suffix must not be a way around the switch.
  return ids.includes(model) || ids.includes(stripThinkingSuffix(model));
}

/**
 * Hard gate for the single-target path.
 * @param {string} provider - Resolved provider id
 * @param {string|null} [model] - Resolved model id (omit for provider-as-model routes)
 * @param {string|null} [requested] - Name the client sent, used in the message
 * @returns {Promise<string|null>} why the route is blocked, or null
 */
export async function getDisabledReason(provider, model = null, requested = null) {
  if (await isProviderDisabled(provider)) return `Provider "${provider}" is disabled`;
  if (model && isDisabledInMap(await getDisabledModelMap(), provider, model)) {
    return `Model "${requested || model}" is disabled`;
  }
  return null;
}

export async function isModelDisabled(provider, model) {
  return (await getDisabledReason(provider, model)) !== null;
}

/**
 * Drop disabled entries from a combo model list before the fallback loop runs,
 * so a disabled model never costs a round trip. Entries that don't resolve to a
 * concrete provider (nested combo names) are kept untouched — the single-model
 * gate catches those further down.
 * @param {string[]} models
 * @returns {Promise<string[]>}
 */
export async function filterDisabledModels(models) {
  if (!Array.isArray(models) || models.length === 0) return models;

  const disabledMap = await getDisabledModelMap();
  const disabledProviders = await getDisabledProviderSet();
  if (Object.keys(disabledMap).length === 0 && disabledProviders.size === 0) return models;

  const kept = [];
  for (const modelStr of models) {
    let info = null;
    try {
      info = await getModelInfo(modelStr);
    } catch {
      // Unresolvable entry — keep it and let the normal path report the error.
    }
    if (info?.provider && (
      disabledProviders.has(resolveProviderId(info.provider))
      || isDisabledInMap(disabledMap, info.provider, info.model)
    )) {
      log.debug("MODELS", `Skipping disabled model "${modelStr}"`);
      continue;
    }
    kept.push(modelStr);
  }
  return kept;
}

/**
 * Same idea for search/fetch combos, where each entry is a provider.
 * @param {string[]} providers
 */
export async function filterDisabledProviders(providers) {
  const disabled = await getDisabledProviderSet();
  if (disabled.size === 0) return providers;
  return providers.filter((p) => !disabled.has(resolveProviderId(p)));
}
