import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken } from "../../server/auth.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

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

  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      type: "CLOUD",
      createdAt: user.createdAt,
    },
  });
}
