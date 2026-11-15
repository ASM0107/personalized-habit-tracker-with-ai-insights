import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRegister } from "../../server/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const clientIp = ((req.headers["x-forwarded-for"] as string) || req.socket?.remoteAddress || "127.0.0.1").split(",")[0].trim();
  const result = await handleRegister(req.body, clientIp);
  res.status(result.status).json(result.body);
}
