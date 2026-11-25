import { PROVIDER_MODELS } from "@/shared/constants/models";
import { resolveProviderId } from "@/shared/constants/providers";
import { getDisabledModelMap, getDisabledProviderSet, isDisabledInMap } from "@/sse/services/disabledModels.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET() {
  try {
    const models = [];
    const seen = new Set();

    function addModel({ name, displayName, description, methods = ["generateContent"] }) {
      if (seen.has(name)) return;
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    const disabledMap = await getDisabledModelMap();
    const disabledProviders = await getDisabledProviderSet();

    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = resolveProviderId(provider);
      if (disabledProviders.has(providerId)) continue;
      for (const model of providerModels) {
        if (isDisabledInMap(disabledMap, providerId, model.id)) continue;
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
          });
        }
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
