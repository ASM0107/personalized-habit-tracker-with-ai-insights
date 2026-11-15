import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const hasKey = Boolean(process.env["GEMINI_API_KEY"] && process.env["GEMINI_API_KEY"].trim().length > 0);
  res.status(200).json({ status: "ok", serverGatewayActive: true, hasServerKey: hasKey });
}
