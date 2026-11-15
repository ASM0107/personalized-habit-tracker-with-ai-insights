import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleAiInferenceRequest } from "../../server/gateway.js";

describe("AI Gateway Security & Robustness Audit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects requests when GEMINI_API_KEY is not configured with 503", async () => {
    const resultMissing = await handleAiInferenceRequest({ prompt: "Hello" }, "");
    expect(resultMissing.status).toBe(503);
    expect(resultMissing.body.error).toContain("GEMINI_API_KEY is not configured");

    const resultWhitespace = await handleAiInferenceRequest({ prompt: "Hello" }, "   ");
    expect(resultWhitespace.status).toBe(503);
  });

  it("rejects non-object or empty prompt payloads with 400", async () => {
    const resultNull = await handleAiInferenceRequest(null, "fake-key");
    expect(resultNull.status).toBe(400);

    const resultNoPrompt = await handleAiInferenceRequest({}, "fake-key");
    expect(resultNoPrompt.status).toBe(400);

    const resultEmptyPrompt = await handleAiInferenceRequest({ prompt: "   " }, "fake-key");
    expect(resultEmptyPrompt.status).toBe(400);
  });

  it("enforces prompt and system instruction size limits with 413", async () => {
    const hugePrompt = "a".repeat(20001);
    const resultPrompt = await handleAiInferenceRequest({ prompt: hugePrompt }, "fake-key");
    expect(resultPrompt.status).toBe(413);
    expect(resultPrompt.body.error).toContain("limit");

    const hugeSystem = "s".repeat(5001);
    const resultSystem = await handleAiInferenceRequest({ prompt: "valid", systemInstruction: hugeSystem }, "fake-key");
    expect(resultSystem.status).toBe(413);
  });

  it("validates response schema JSON format and size limits", async () => {
    const resultMalformedSchema = await handleAiInferenceRequest(
      { prompt: "valid", responseSchemaJson: "{ invalid json " },
      "fake-key"
    );
    expect(resultMalformedSchema.status).toBe(400);

    const hugeSchema = "b".repeat(10001);
    const resultOversizedSchema = await handleAiInferenceRequest(
      { prompt: "valid", responseSchemaJson: hugeSchema },
      "fake-key"
    );
    expect(resultOversizedSchema.status).toBe(413);
  });

  it("enforces sliding-window rate limiting per client identifier", async () => {
    const clientId = `audit-client-${Date.now()}`;
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    for (let i = 0; i < 30; i++) {
      const response = await handleAiInferenceRequest({ prompt: "ping" }, "fake-key", clientId);
      expect(response.status).toBe(200);
    }

    const rateLimitedResponse = await handleAiInferenceRequest({ prompt: "ping" }, "fake-key", clientId);
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.body.error).toContain("Too many AI inference requests");

    mockFetch.mockRestore();
  });

  it("transmits API key exclusively through x-goog-api-key header and strips from URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ verified: true }) }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const secretKey = "super-secret-production-key-998877";
    const res = await handleAiInferenceRequest(
      { prompt: "Analyze habit cadence", modelName: "gemini-3.5-flash-lite" },
      secretKey,
      "isolated-client-auth-test"
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).not.toContain(secretKey);
    expect(capturedUrl).not.toContain("key=");
    expect(capturedHeaders["x-goog-api-key"]).toBe(secretKey);
  });

  it("sanitizes upstream error responses and shields internal provider diagnostics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota)." } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    });

    const res429 = await handleAiInferenceRequest({ prompt: "test" }, "fake-key", "client-err-429");
    expect(res429.status).toBe(429);
    expect(res429.body.error).toBe("Upstream AI rate limit exceeded. Please retry shortly.");
    expect(JSON.stringify(res429.body)).not.toContain("Resource has been exhausted");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Internal Server Error in Google Borg Cluster", { status: 500 });
    });

    const res500 = await handleAiInferenceRequest({ prompt: "test" }, "fake-key", "client-err-500");
    expect(res500.status).toBe(502);
    expect(res500.body.error).toBe("Upstream AI service temporarily unavailable.");
    expect(JSON.stringify(res500.body)).not.toContain("Borg");
  });

  it("handles upstream timeouts gracefully with 504 Gateway Timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    });

    const resTimeout = await handleAiInferenceRequest({ prompt: "test" }, "fake-key", "client-timeout");
    expect(resTimeout.status).toBe(504);
    expect(resTimeout.body.error).toContain("AI gateway timeout");
  });
});
