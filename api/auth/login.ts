import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleLogin } from "../../server/auth.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const clientIp = ((req.headers["x-forwarded-for"] as string) || req.socket?.remoteAddress || "127.0.0.1").split(",")[0].trim();
  const result = handleLogin(req.body, clientIp);
  res.status(result.status).json(result.body);
}
