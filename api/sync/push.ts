import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, handleSyncPush } from "../../server/auth.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const user = verifyToken(authHeader);
  if (!user) {
    res.status(401).json({ error: "Unauthorized: invalid or missing authentication token" });
    return;
  }

  const envelopes = req.body?.envelopes;
  const result = handleSyncPush(user.id, envelopes);
  res.status(result.status).json(result.body);
}
