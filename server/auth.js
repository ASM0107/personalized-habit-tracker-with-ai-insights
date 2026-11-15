import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORAGE_FILE = path.join(os.tmpdir(), "habit_tracker_cloud_storage.json");
const AUTH_SECRET = process.env.AUTH_SECRET || "habit_tracker_super_secure_secret_key_2026";
const authRateLimitMap = new Map();

function checkAuthRateLimit(key, limit = 20, windowMs = 60000) {
  const now = Date.now();
  const entry = authRateLimitMap.get(key) || [];
  const validTimestamps = entry.filter((t) => now - t < windowMs);
  if (validTimestamps.length >= limit) {
    return false;
  }
  validTimestamps.push(now);
  authRateLimitMap.set(key, validTimestamps);
  return true;
}

let dbState = {
  users: {},
  userEnvelopes: {},
  serverClocks: {},
};

function loadState() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, "utf-8");
      dbState = JSON.parse(raw);
    }
  } catch {
    dbState = { users: {}, userEnvelopes: {}, serverClocks: {} };
  }
}

function saveState() {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(dbState), "utf-8");
  } catch {
    return;
  }
}

loadState();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function signToken(user, customTimestamp = Date.now()) {
  const payload = JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    ts: customTimestamp,
  });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const hmac = crypto.createHmac("sha256", AUTH_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${hmac}`;
}

export function verifyToken(rawToken) {
  try {
    const token = (rawToken || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return null;
    }
    const parts = token.split(".");
    if (parts.length !== 2) {
      return null;
    }
    const [payloadB64, hmac] = parts;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payloadB64).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
      return null;
    }
    const user = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (!user || typeof user !== "object" || !user.id || !user.email) {
      return null;
    }
    const maxTokenAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (typeof user.ts !== "number" || Date.now() - user.ts > maxTokenAgeMs) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function handleRegister(payload, clientIp = "local") {
  if (!checkAuthRateLimit(`reg_${clientIp}`, 15, 60000)) {
    return { status: 429, body: { error: "Too many registration attempts. Please wait." } };
  }
  loadState();
  const email = (payload?.email || "").trim().toLowerCase();
  const password = payload?.password || "";
  const name = (payload?.name || "").trim() || email.split("@")[0] || "Cloud User";

  if (!email || !email.includes("@")) {
    return { status: 400, body: { error: "A valid email address is required" } };
  }
  if (password.length < 6) {
    return { status: 400, body: { error: "Password must be at least 6 characters" } };
  }

  const existing = Object.values(dbState.users).find((u) => u.email === email);
  if (existing) {
    return { status: 409, body: { error: "An account with this email already exists" } };
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const id = `usr_${crypto.randomBytes(8).toString("hex")}`;
  const user = {
    id,
    email,
    name,
    passwordHash,
    salt,
    createdAt: Date.now(),
  };

  dbState.users[id] = user;
  dbState.userEnvelopes[id] = [];
  dbState.serverClocks[id] = 0;
  saveState();

  const token = signToken(user);
  return {
    status: 201,
    body: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        type: "CLOUD",
        createdAt: user.createdAt,
      },
      token,
    },
  };
}

export function handleLogin(payload, clientIp = "local") {
  if (!checkAuthRateLimit(`login_${clientIp}`, 20, 60000)) {
    return { status: 429, body: { error: "Too many login attempts. Please wait." } };
  }
  loadState();
  const email = (payload?.email || "").trim().toLowerCase();
  const password = payload?.password || "";

  if (!email || !password) {
    return { status: 400, body: { error: "Email and password are required" } };
  }

  const user = Object.values(dbState.users).find((u) => u.email === email);
  if (!user) {
    return { status: 401, body: { error: "Invalid email or password" } };
  }

  const computedHash = hashPassword(password, user.salt);
  if (!crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(user.passwordHash))) {
    return { status: 401, body: { error: "Invalid email or password" } };
  }

  const token = signToken(user);
  return {
    status: 200,
    body: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        type: "CLOUD",
        createdAt: user.createdAt,
      },
      token,
    },
  };
}

export function handleSyncPush(userId, envelopes) {
  loadState();
  if (!dbState.userEnvelopes[userId]) {
    dbState.userEnvelopes[userId] = [];
  }
  if (!dbState.serverClocks[userId]) {
    dbState.serverClocks[userId] = 0;
  }

  const existingList = dbState.userEnvelopes[userId];
  let currentClock = dbState.serverClocks[userId];

  const incoming = Array.isArray(envelopes) ? envelopes : [];
  for (const envelope of incoming) {
    currentClock = Math.max(currentClock, envelope.lamportTimestamp || 0) + 1;
    const itemWithUser = { ...envelope, userId, lamportTimestamp: currentClock };
    const existingIndex = existingList.findIndex(
      (e) => e.entityId === envelope.entityId && e.entityType === envelope.entityType
    );
    if (existingIndex >= 0) {
      const current = existingList[existingIndex];
      if ((envelope.lamportTimestamp || 0) >= (current.lamportTimestamp || 0)) {
        existingList[existingIndex] = itemWithUser;
      }
    } else {
      existingList.push(itemWithUser);
    }
  }

  dbState.serverClocks[userId] = currentClock;
  saveState();

  return {
    status: 200,
    body: {
      success: true,
      committedCount: incoming.length,
      serverLamportTimestamp: currentClock,
    },
  };
}

export function handleSyncPull(userId, sinceLamport = 0) {
  loadState();
  const list = dbState.userEnvelopes[userId] || [];
  const clock = dbState.serverClocks[userId] || 0;
  const filtered = list.filter((e) => (e.lamportTimestamp || 0) > Number(sinceLamport || 0));

  return {
    status: 200,
    body: {
      envelopes: filtered,
      latestServerTimestamp: clock,
    },
  };
}
