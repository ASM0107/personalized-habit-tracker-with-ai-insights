import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAiInferenceRequest } from "../../server/gateway.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const apiKey = process.env["GEMINI_API_KEY"] || "";
  const result = await handleAiInferenceRequest(req.body, apiKey);
  res.status(result.status).json(result.body);
}
