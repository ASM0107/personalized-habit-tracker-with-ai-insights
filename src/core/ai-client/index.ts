export interface AiClientConfig {
  readonly apiKey?: string;
  readonly modelName?: string;
  readonly maxRetries?: number;
  readonly serverEndpoint?: string;
}

export interface PromptPayload {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchemaJson: string;
}

export interface AiInferencePort {
  generateStructured<T>(payload: PromptPayload): Promise<T>;
}

export class MockAiInferenceClient implements AiInferencePort {
  private readonly defaultResponse: unknown;

  public constructor(defaultResponse: unknown) {
    this.defaultResponse = defaultResponse;
  }

  public async generateStructured<T>(_payload: PromptPayload): Promise<T> {
    return this.defaultResponse as T;
  }
}

export class GeminiInferenceClient implements AiInferencePort {
  private static readonly STORAGE_KEY = "habit_tracker_gemini_api_key";
  public static readonly DEFAULT_SERVER_ENDPOINT = "/api/ai/infer";

  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly maxRetries: number;
  private readonly serverEndpoint: string;

  public constructor(config: AiClientConfig = {}) {
    if (config.apiKey !== undefined) {
      this.apiKey = config.apiKey;
    } else {
      const fromStorage =
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage.getItem(GeminiInferenceClient.STORAGE_KEY) ?? ""
          : "";
      const fromProcess =
        typeof process !== "undefined" && process.env
          ? process.env["GEMINI_API_KEY"] ?? ""
          : "";

      this.apiKey = fromStorage || fromProcess;
    }

    this.modelName = config.modelName ?? "gemini-3.5-flash-lite";
    this.maxRetries = config.maxRetries ?? 3;
    this.serverEndpoint = config.serverEndpoint ?? GeminiInferenceClient.DEFAULT_SERVER_ENDPOINT;
  }

  public hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  public isUsingServerGateway(): boolean {
    return this.apiKey.length === 0;
  }

  public static getStoredApiKey(): string {
    if (typeof window === "undefined" || !window.localStorage) {
      return "";
    }
    return window.localStorage.getItem(GeminiInferenceClient.STORAGE_KEY) ?? "";
  }

  public static storeApiKeyLocally(key: string): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    if (key.trim().length === 0) {
      window.localStorage.removeItem(GeminiInferenceClient.STORAGE_KEY);
    } else {
      window.localStorage.setItem(GeminiInferenceClient.STORAGE_KEY, key.trim());
    }
  }

  public static async checkServerHealth(endpoint = "/api/ai/health"): Promise<{ hasServerKey: boolean }> {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        return { hasServerKey: false };
      }
      const data = (await res.json()) as { hasServerKey?: boolean };
      return { hasServerKey: Boolean(data.hasServerKey) };
    } catch {
      return { hasServerKey: false };
    }
  }

  public async generateStructured<T>(payload: PromptPayload): Promise<T> {
    if (this.apiKey.length > 0) {
      return this.invokeDirectApi<T>(payload);
    }
    return this.invokeServerGateway<T>(payload);
  }

  private async invokeServerGateway<T>(payload: PromptPayload): Promise<T> {
    let attempt = 0;
    let delayMs = 300;

    while (attempt < this.maxRetries) {
      try {
        const response = await fetch(this.serverEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Server AI Gateway status ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as { data?: T; error?: string };
        if (data.error) {
          throw new Error(`Server AI Gateway: ${data.error}`);
        }
        if (data.data === undefined) {
          throw new Error("Invalid response format from Server AI Gateway");
        }

        return data.data;
      } catch (error) {
        attempt += 1;
        if (attempt >= this.maxRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }

    throw new Error("Max retries exceeded during Server AI Gateway invocation");
  }

  private async invokeDirectApi<T>(payload: PromptPayload): Promise<T> {
    let attempt = 0;
    let delayMs = 300;

    while (attempt < this.maxRetries) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`,
          {
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
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP status ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Empty candidate payload from Gemini API");
        }

        return JSON.parse(text) as T;
      } catch (error) {
        attempt += 1;
        if (attempt >= this.maxRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }

    throw new Error("Max retries exceeded during Gemini API invocation");
  }
}
