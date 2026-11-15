import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRegister } from "../../server/auth.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const result = handleRegister(req.body);
  res.status(result.status).json(result.body);
}
