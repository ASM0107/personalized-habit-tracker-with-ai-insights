const ALLOWED_MODELS = new Set([
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
]);

const MAX_PROMPT_LENGTH = 20000;
const MAX_SYSTEM_INSTRUCTION_LENGTH = 5000;
const MAX_SCHEMA_LENGTH = 10000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 30;

const clientRequestCounts = new Map();

function isRateLimited(clientId) {
  const now = Date.now();
  const record = clientRequestCounts.get(clientId);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    clientRequestCounts.set(clientId, { windowStart: now, count: 1 });
    return false;
  }

  record.count += 1;
  return record.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function handleAiInferenceRequest(payload, apiKey, clientId = "anonymous") {
  if (!apiKey || apiKey.trim().length === 0) {
    return {
      status: 503,
      body: { error: "GEMINI_API_KEY is not configured on the server environment" },
    };
  }

  if (isRateLimited(clientId)) {
    return {
      status: 429,
      body: { error: "Too many AI inference requests. Please retry in a moment." },
    };
  }

  if (!payload || typeof payload !== "object") {
    return {
      status: 400,
      body: { error: "Invalid request payload: expected a JSON object" },
    };
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return {
      status: 400,
      body: { error: "Prompt is required and must not be empty" },
    };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      status: 413,
      body: { error: `Prompt length exceeds maximum allowed limit of ${MAX_PROMPT_LENGTH} characters` },
    };
  }

  const systemInstruction = typeof payload.systemInstruction === "string" ? payload.systemInstruction.trim() : "";
  if (systemInstruction.length > MAX_SYSTEM_INSTRUCTION_LENGTH) {
    return {
      status: 413,
      body: { error: `System instruction exceeds maximum allowed limit of ${MAX_SYSTEM_INSTRUCTION_LENGTH} characters` },
    };
  }

  const requestedModel = typeof payload.modelName === "string" ? payload.modelName.trim() : "";
  const modelName = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "gemini-3.5-flash-lite";

  let parsedSchema = null;
  if (payload.responseSchemaJson) {
    if (typeof payload.responseSchemaJson !== "string") {
      return {
        status: 400,
        body: { error: "responseSchemaJson must be a string" },
      };
    }
    if (payload.responseSchemaJson.length > MAX_SCHEMA_LENGTH) {
      return {
        status: 413,
        body: { error: `Response schema length exceeds limit of ${MAX_SCHEMA_LENGTH} characters` },
      };
    }
    try {
      parsedSchema = JSON.parse(payload.responseSchemaJson);
    } catch {
      return {
        status: 400,
        body: { error: "Malformed responseSchemaJson: unable to parse JSON schema" },
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const generationConfig = {
      responseMimeType: "application/json",
    };
    if (parsedSchema) {
      generationConfig.responseSchema = parsedSchema;
    }

    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig,
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!upstreamResponse.ok) {
      const sanitizedMessage =
        upstreamResponse.status === 429
          ? "Upstream AI rate limit exceeded. Please retry shortly."
          : upstreamResponse.status === 400
          ? "Invalid request structure for upstream AI provider."
          : "Upstream AI service temporarily unavailable.";

      return {
        status: upstreamResponse.status >= 500 ? 502 : upstreamResponse.status,
        body: { error: sanitizedMessage },
      };
    }

    const json = await upstreamResponse.json();
    const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return {
        status: 502,
        body: { error: "Upstream AI returned an empty candidate response" },
      };
    }

    const parsedData = JSON.parse(candidateText);
    return {
      status: 200,
      body: { data: parsedData },
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error?.name === "AbortError") {
      return {
        status: 504,
        body: { error: "AI gateway timeout: upstream provider did not respond within 30 seconds" },
      };
    }

    return {
      status: 500,
      body: { error: "An unexpected error occurred while communicating with the AI gateway" },
    };
  }
}
