import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORAGE_FILE =
  process.env.HABIT_TRACKER_STORAGE_FILE ||
  path.join(os.tmpdir(), "habit_tracker_cloud_storage.json");
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
  changeLogs: {},
  serverCursors: {},
  materializedState: {},
  processedOperations: {},
};

function loadState() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, "utf-8");
      const diskState = JSON.parse(raw);
      if (diskState && typeof diskState === "object") {
        dbState.users = { ...(diskState.users || {}), ...dbState.users };
        dbState.changeLogs = { ...(diskState.changeLogs || {}), ...dbState.changeLogs };
        dbState.serverCursors = { ...(diskState.serverCursors || {}), ...dbState.serverCursors };
        dbState.materializedState = { ...(diskState.materializedState || {}), ...dbState.materializedState };
        dbState.processedOperations = { ...(diskState.processedOperations || {}), ...dbState.processedOperations };
      }
    }
  } catch {
    return;
  }
}

function saveState() {
  try {
    let existingOnDisk = {
      users: {},
      changeLogs: {},
      serverCursors: {},
      materializedState: {},
      processedOperations: {},
    };
    if (fs.existsSync(STORAGE_FILE)) {
      try {
        const raw = fs.readFileSync(STORAGE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          existingOnDisk = parsed;
        }
      } catch {
        existingOnDisk = {
          users: {},
          changeLogs: {},
          serverCursors: {},
          materializedState: {},
          processedOperations: {},
        };
      }
    }
    const merged = {
      users: { ...(existingOnDisk.users || {}), ...dbState.users },
      changeLogs: { ...(existingOnDisk.changeLogs || {}), ...dbState.changeLogs },
      serverCursors: { ...(existingOnDisk.serverCursors || {}), ...dbState.serverCursors },
      materializedState: { ...(existingOnDisk.materializedState || {}), ...dbState.materializedState },
      processedOperations: { ...(existingOnDisk.processedOperations || {}), ...dbState.processedOperations },
    };
    dbState = merged;
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(merged), "utf-8");
  } catch {
    return;
  }
}

loadState();

function hashPasswordAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (err, derivedKey) => {
        if (err) {
          reject(err);
        } else {
          resolve(derivedKey.toString("hex"));
        }
      }
    );
  });
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

export async function handleRegister(payload, clientIp = "local") {
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
  const passwordHash = await hashPasswordAsync(password, salt);
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
  dbState.changeLogs[id] = [];
  dbState.serverCursors[id] = 0;
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

export async function handleLogin(payload, clientIp = "local") {
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

  const computedHash = await hashPasswordAsync(password, user.salt);
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
  if (!dbState.changeLogs[userId]) {
    dbState.changeLogs[userId] = [];
  }
  if (!dbState.serverCursors[userId]) {
    dbState.serverCursors[userId] = 0;
  }
  if (!dbState.materializedState[userId]) {
    dbState.materializedState[userId] = {};
  }
  if (!dbState.processedOperations[userId]) {
    dbState.processedOperations[userId] = {};
  }

  const userLogs = dbState.changeLogs[userId];
  const userMaterialized = dbState.materializedState[userId];
  const userProcessedOps = dbState.processedOperations[userId];
  let cursor = dbState.serverCursors[userId];
  let newlyCommittedCount = 0;

  for (const envelope of envelopes) {
    const opId =
      envelope.operationId ||
      `op_${envelope.deviceId || "anon"}_${envelope.lamportTimestamp || Date.now()}_${envelope.entityId}`;

    if (userProcessedOps[opId]) {
      continue;
    }

    cursor += 1;
    newlyCommittedCount += 1;
    userProcessedOps[opId] = { sequence: cursor, committedAt: Date.now() };

    const isDeleted = Boolean(envelope.isDeleted || envelope.tombstone);
    const changeRecord = {
      sequence: cursor,
      serverCursor: cursor,
      operationId: opId,
      entityId: envelope.entityId,
      entityType: envelope.entityType,
      operation: isDeleted ? "DELETE" : "UPSERT",
      lamportTimestamp: envelope.lamportTimestamp || 0,
      deviceId: envelope.deviceId || envelope.clientId || "",
      payload: envelope.payload,
      isDeleted,
      tombstone: isDeleted,
      createdAt: Date.now(),
      userId,
    };
    userLogs.push(changeRecord);

    const entityKey = `${changeRecord.entityType}:${changeRecord.entityId}`;
    const existing = userMaterialized[entityKey];

    let incomingWins = false;
    if (!existing) {
      incomingWins = true;
    } else if (changeRecord.lamportTimestamp > existing.lamportTimestamp) {
      incomingWins = true;
    } else if (changeRecord.lamportTimestamp < existing.lamportTimestamp) {
      incomingWins = false;
    } else if (changeRecord.deviceId !== existing.deviceId) {
      incomingWins = changeRecord.deviceId > existing.deviceId;
    } else {
      incomingWins = (changeRecord.operationId || "") >= (existing.operationId || "");
    }

    if (incomingWins) {
      userMaterialized[entityKey] = {
        entityId: changeRecord.entityId,
        entityType: changeRecord.entityType,
        payload: changeRecord.payload,
        lamportTimestamp: changeRecord.lamportTimestamp,
        deviceId: changeRecord.deviceId,
        operationId: changeRecord.operationId,
        isDeleted: changeRecord.isDeleted,
        tombstone: changeRecord.tombstone,
        serverCursor: cursor,
        updatedAt: Date.now(),
      };
    }
  }

  dbState.serverCursors[userId] = cursor;
  saveState();

  return {
    status: 200,
    body: {
      success: true,
      committedCount: envelopes.length,
      newlyCommittedCount,
      serverCursor: cursor,
      serverLamportTimestamp: cursor,
    },
  };
}

export function handleSyncPull(userId, sinceCursor = 0, limit = 100) {
  loadState();
  const list = dbState.changeLogs[userId] || [];
  const latestCursor = dbState.serverCursors[userId] || 0;
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const since = Number(sinceCursor) || 0;

  const filtered = list.filter((c) => c.sequence > since);
  filtered.sort((a, b) => a.sequence - b.sequence);

  const page = filtered.slice(0, safeLimit);
  const hasMore = filtered.length > safeLimit;
  const nextCursor = page.length > 0 ? page[page.length - 1].sequence : since;
  const materializedList = Object.values(dbState.materializedState[userId] || {});

  return {
    status: 200,
    body: {
      envelopes: page,
      changes: page,
      materialized: materializedList,
      nextCursor,
      hasMore,
      latestServerCursor: latestCursor,
      latestServerTimestamp: latestCursor,
    },
  };
}

export function handleSyncGetMaterialized(userId) {
  loadState();
  const state = dbState.materializedState[userId] || {};
  return {
    status: 200,
    body: {
      entities: Object.values(state),
      latestServerCursor: dbState.serverCursors[userId] || 0,
    },
  };
}
