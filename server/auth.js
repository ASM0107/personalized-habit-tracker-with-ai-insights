import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORAGE_FILE = path.join(os.tmpdir(), "habit_tracker_cloud_storage.json");
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("AUTH_SECRET environment variable is mandatory in production");
      })()
    : "habit_tracker_dev_test_secret_key_2026");

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
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
}

export function signToken(user, customTimestamp = Date.now()) {
  const payload = JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt || customTimestamp,
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
    const now = Date.now();
    if (typeof user.ts !== "number" || now - user.ts > maxTokenAgeMs || user.ts > now + 60000) {
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
  if (password.length < 8) {
    return { status: 400, body: { error: "Password must be at least 8 characters" } };
  }
  if (password.length > 128) {
    return { status: 400, body: { error: "Password must not exceed 128 characters" } };
  }

  const existing = Object.values(dbState.users).find((u) => u.email === email);
  if (existing) {
    return { status: 409, body: { error: "An account with this email already exists" } };
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const id = `usr_${crypto.randomBytes(8).toString("hex")}`;
  const createdAt = Date.now();
  const user = {
    id,
    email,
    name,
    passwordHash,
    salt,
    createdAt,
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
  if (!Array.isArray(envelopes)) {
    return { status: 400, body: { error: "Expected an array of envelopes" } };
  }
  if (envelopes.length > 500) {
    return { status: 413, body: { error: "Sync envelope batch size exceeds limit of 500" } };
  }
  for (const env of envelopes) {
    if (
      !env ||
      typeof env !== "object" ||
      !env.entityId ||
      typeof env.entityId !== "string" ||
      !env.entityType ||
      typeof env.entityType !== "string"
    ) {
      return { status: 400, body: { error: "Malformed sync envelope structure" } };
    }
  }

  loadState();
  if (!dbState.userEnvelopes[userId]) {
    dbState.userEnvelopes[userId] = [];
  }
  if (!dbState.serverClocks[userId]) {
    dbState.serverClocks[userId] = 0;
  }

  const existingList = dbState.userEnvelopes[userId];
  let currentClock = dbState.serverClocks[userId];

  for (const envelope of envelopes) {
    currentClock = Math.max(currentClock, envelope.lamportTimestamp || 0) + 1;
    const itemWithUser = {
      ...envelope,
      userId,
      lamportTimestamp: envelope.lamportTimestamp || 0,
      serverCursor: currentClock,
    };
    const existingIndex = existingList.findIndex(
      (e) => e.entityId === envelope.entityId && e.entityType === envelope.entityType
    );
    if (existingIndex >= 0) {
      const current = existingList[existingIndex];
      const incomingTimestamp = envelope.lamportTimestamp || 0;
      const currentTimestamp = current.lamportTimestamp || 0;
      if (incomingTimestamp > currentTimestamp) {
        existingList[existingIndex] = itemWithUser;
      } else if (incomingTimestamp === currentTimestamp) {
        const incomingDevice = envelope.deviceId || envelope.clientId || "";
        const currentDevice = current.deviceId || current.clientId || "";
        if (incomingDevice.localeCompare(currentDevice) >= 0) {
          existingList[existingIndex] = itemWithUser;
        }
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
      committedCount: envelopes.length,
      serverLamportTimestamp: currentClock,
    },
  };
}

export function handleSyncPull(userId, sinceCursor = 0, limit = 100) {
  loadState();
  const list = dbState.userEnvelopes[userId] || [];
  const clock = dbState.serverClocks[userId] || 0;
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const filtered = list
    .filter((e) => (e.serverCursor || e.lamportTimestamp || 0) > Number(sinceCursor || 0))
    .sort((a, b) => (a.serverCursor || a.lamportTimestamp || 0) - (b.serverCursor || b.lamportTimestamp || 0));

  const page = filtered.slice(0, safeLimit);
  const hasMore = filtered.length > safeLimit;
  const nextCursor =
    page.length > 0
      ? page[page.length - 1].serverCursor || page[page.length - 1].lamportTimestamp
      : Number(sinceCursor || 0);

  return {
    status: 200,
    body: {
      envelopes: page,
      latestServerTimestamp: clock,
      nextCursor,
      hasMore,
    },
  };
}
