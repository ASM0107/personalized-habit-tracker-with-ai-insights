export interface AiGatewayPayload {
  readonly prompt?: string;
  readonly systemInstruction?: string;
  readonly modelName?: string;
  readonly responseSchemaJson?: string;
}

export interface AiGatewayResult {
  readonly status: number;
  readonly body: {
    readonly data?: unknown;
    readonly error?: string;
  };
}

export function handleAiInferenceRequest(
  payload: AiGatewayPayload | unknown,
  apiKey: string,
  clientId?: string
): Promise<AiGatewayResult>;
