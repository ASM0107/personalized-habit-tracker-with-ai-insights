import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAiInferenceRequest } from "../../server/gateway.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    res.status(415).json({ error: "Unsupported Media Type: Content-Type must be application/json" });
    return;
  }

  const forwarded = req.headers["x-forwarded-for"];
  const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() || "unknown" : "local";
  const apiKey = process.env["GEMINI_API_KEY"] || "";

  const result = await handleAiInferenceRequest(req.body, apiKey, clientIp);
  res.status(result.status).json(result.body);
}
