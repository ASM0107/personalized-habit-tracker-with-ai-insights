import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, handleSyncPull } from "../../server/auth.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const user = verifyToken(authHeader);
  if (!user) {
    res.status(401).json({ error: "Unauthorized: invalid or missing authentication token" });
    return;
  }

  const since = req.query["since"];
  const sinceLamport = typeof since === "string" ? Number.parseInt(since, 10) : 0;
  const result = handleSyncPull(user.id, sinceLamport);
  res.status(result.status).json(result.body);
}
