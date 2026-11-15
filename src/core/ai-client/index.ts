export interface AiClientConfig {
  readonly apiKey?: string;
  readonly modelName?: string;
  readonly maxRetries?: number;
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
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly maxRetries: number;

  public constructor(config: AiClientConfig = {}) {
    const fromConfig = config.apiKey ?? "";
    const fromStorage =
      typeof window !== "undefined" && window.localStorage
        ? window.localStorage.getItem(GeminiInferenceClient.STORAGE_KEY) ?? ""
        : "";
    const fromMeta =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_GEMINI_API_KEY
        ? import.meta.env.VITE_GEMINI_API_KEY
        : "";
    const fromProcess =
      typeof process !== "undefined" && process.env
        ? process.env["GEMINI_API_KEY"] ?? ""
        : "";

    this.apiKey = fromConfig || fromStorage || fromMeta || fromProcess;
    this.modelName = config.modelName ?? "gemini-2.0-flash";
    this.maxRetries = config.maxRetries ?? 3;
  }

  public hasApiKey(): boolean {
    return this.apiKey.length > 0;
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

  public async generateStructured<T>(payload: PromptPayload): Promise<T> {
    if (!this.apiKey) {
      throw new Error("Missing GEMINI_API_KEY for inference");
    }

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
