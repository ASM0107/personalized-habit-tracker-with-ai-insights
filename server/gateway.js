export async function handleAiInferenceRequest(payload, apiKey) {
  if (!apiKey || apiKey.trim().length === 0) {
    return {
      status: 503,
      body: { error: "GEMINI_API_KEY is not configured on the server environment" },
    };
  }

  const modelName = payload.modelName || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: payload.systemInstruction }],
        },
        contents: [
          {
            parts: [{ text: payload.prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: JSON.parse(payload.responseSchemaJson),
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return {
        status: upstreamResponse.status,
        body: { error: `Gemini Upstream Error: ${errText}` },
      };
    }

    const json = await upstreamResponse.json();
    const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return {
        status: 502,
        body: { error: "No candidate text returned by Gemini API" },
      };
    }

    const parsedData = JSON.parse(candidateText);
    return {
      status: 200,
      body: { data: parsedData },
    };
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      status: 500,
      body: { error: error.message || "Internal server error during inference" },
    };
  }
}
