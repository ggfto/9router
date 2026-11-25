// Turns the many /models response shapes into [{ id, name, kind }]. Upstream
// data is untrusted: ids are validated and the list is capped.

const MAX_MODELS_PER_PROVIDER = 2000;
const MAX_ID_LENGTH = 200;
const VALID_ID = /^[^\s\p{C}]+$/u;
const KNOWN_KINDS = new Set(["llm", "image", "tts", "stt", "embedding", "imageToText", "video"]);
// These resolvers return "<providerId>/<model>" for the dashboard's benefit.
// Everywhere else a leading segment is part of the id (e.g. "openrouter/auto").
const SELF_PREFIXED_PROVIDERS = new Set(["qoder", "qoder-cn", "nous"]);

function inferKind(item, id) {
  const declared = item?.kind || item?.type;
  if (KNOWN_KINDS.has(declared)) return declared;
  if (item?.supportedGenerationMethods?.includes?.("embedContent")) return "embedding";
  const lower = id.toLowerCase();
  if (/embed|rerank/.test(lower)) return "embedding";
  if (/whisper|transcri/.test(lower)) return "stt";
  if (/(^|[-_/])tts($|[-_/])/.test(lower)) return "tts";
  if (/dall-?e|imagen|stable-diffusion|sdxl|flux|gpt-image/.test(lower)) return "image";
  if (/(^|[-_/])(sora|veo)($|[-_/])/.test(lower)) return "video";
  return "llm";
}

export function normalizeSyncedModels(providerId, rawModels) {
  const out = new Map();
  for (const item of Array.isArray(rawModels) ? rawModels : []) {
    const isText = typeof item === "string";
    let id = isText ? item : item?.id || item?.slug || item?.model || item?.name;
    if (typeof id !== "string") continue;
    id = id.trim();
    if (id.startsWith("models/")) id = id.slice("models/".length); // Gemini
    if (SELF_PREFIXED_PROVIDERS.has(providerId) && id.startsWith(`${providerId}/`)) {
      id = id.slice(providerId.length + 1);
    }
    if (!id || id.length > MAX_ID_LENGTH || !VALID_ID.test(id) || out.has(id)) continue;
    const label = isText ? null : item.displayName || item.display_name || item.name;
    const name = typeof label === "string" && label ? label.slice(0, MAX_ID_LENGTH) : id;
    out.set(id, { id, name: name.startsWith("models/") ? id : name, kind: inferKind(isText ? null : item, id) });
    if (out.size >= MAX_MODELS_PER_PROVIDER) break;
  }
  return [...out.values()];
}
