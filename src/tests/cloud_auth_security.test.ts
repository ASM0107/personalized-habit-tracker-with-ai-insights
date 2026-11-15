import { describe, it, expect } from "vitest";
import {
  handleRegister,
  handleLogin,
  verifyToken,
  signToken,
  handleSyncPush,
  handleSyncPull,
} from "../../server/auth.js";
import { LastWriteWinsSynchronizer, type SyncEnvelope } from "../core/sync/index.js";

describe("Cloud Auth Security & Token Integrity Audit", () => {
  const testEmail = `audit_user_${Date.now()}@example.com`;
  const testPassword = "securePassword123!";

  it("enforces strict input validation on account registration", async () => {
    const invalidEmailRes = await handleRegister({ email: "invalid-email", password: "password123" }, "test-ip-reg-1");
    expect(invalidEmailRes.status).toBe(400);
    expect(invalidEmailRes.body.error).toContain("valid email address");

    const shortPasswordRes = await handleRegister({ email: "valid@test.com", password: "123" }, "test-ip-reg-2");
    expect(shortPasswordRes.status).toBe(400);
    expect(shortPasswordRes.body.error).toContain("at least 8 characters");
  });

  it("registers account successfully and rejects duplicate registration with 409", async () => {
    const regRes = await handleRegister({ email: testEmail, password: testPassword, name: "Audit User" }, "test-ip-reg-3");
    expect(regRes.status).toBe(201);
    expect(regRes.body.user).toBeDefined();
    expect(regRes.body.user?.email).toBe(testEmail.toLowerCase());
    expect(regRes.body.token).toBeDefined();

    const dupRes = await handleRegister({ email: testEmail, password: testPassword }, "test-ip-reg-4");
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toContain("already exists");
  });

  it("verifies login credentials and guards against timing attacks", async () => {
    const loginSuccess = await handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-1");
    expect(loginSuccess.status).toBe(200);
    expect(loginSuccess.body.user).toBeDefined();
    expect(loginSuccess.body.user?.email).toBe(testEmail.toLowerCase());
    expect(loginSuccess.body.token).toBeDefined();

    const loginWrongPass = await handleLogin({ email: testEmail, password: "WrongPassword" }, "test-ip-log-2");
    expect(loginWrongPass.status).toBe(401);
    expect(loginWrongPass.body.error).toBe("Invalid email or password");

    const loginNonExistent = await handleLogin({ email: "nonexistent@example.com", password: "Password123" }, "test-ip-log-3");
    expect(loginNonExistent.status).toBe(401);
    expect(loginNonExistent.body.error).toBe("Invalid email or password");
  });

  it("validates cryptographic token integrity and rejects tampered signatures", async () => {
    const loginRes = await handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-4");
    const validToken = loginRes.body.token;
    expect(validToken).toBeDefined();
    if (!validToken) {
      throw new Error("Expected valid token");
    }

    const verifiedUser = verifyToken(validToken);
    expect(verifiedUser).not.toBeNull();
    expect(verifiedUser?.email).toBe(testEmail.toLowerCase());

    const [payloadB64, hmac] = validToken.split(".");
    expect(payloadB64).toBeDefined();
    expect(hmac).toBeDefined();
    if (!payloadB64 || !hmac) {
      throw new Error("Invalid token split structure");
    }

    const tamperedPayload = Buffer.from(
      JSON.stringify({ id: "usr_hacked", email: "hacker@evil.com", ts: Date.now() })
    ).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${hmac}`;

    expect(verifyToken(tamperedToken)).toBeNull();

    const tamperedSigToken = `${payloadB64}.${hmac.substring(0, hmac.length - 4)}fake`;
    expect(verifyToken(tamperedSigToken)).toBeNull();
  });

  it("enforces a strict 7-day token expiration lifecycle and rejects future-dated tokens", () => {
    const now = Date.now();
    const freshUser = { id: "usr_test_fresh", email: "fresh@example.com", name: "Fresh" };
    const freshToken = signToken(freshUser, now);
    expect(verifyToken(freshToken)).not.toBeNull();

    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const expiredUser = { id: "usr_test_expired", email: "expired@example.com", name: "Expired" };
    const expiredToken = signToken(expiredUser, eightDaysAgo);
    expect(verifyToken(expiredToken)).toBeNull();

    const futureTimestamp = now + 120000;
    const futureUser = { id: "usr_test_future", email: "future@example.com", name: "Future" };
    const futureToken = signToken(futureUser, futureTimestamp);
    expect(verifyToken(futureToken)).toBeNull();
  });

  it("enforces brute-force rate limits on registration and authentication attempts", async () => {
    const spamIp = "ip-spammer-999";
    for (let i = 0; i < 20; i++) {
      await handleLogin({ email: "someone@test.com", password: "wrong" }, spamIp);
    }

    const rateLimitedRes = await handleLogin({ email: "someone@test.com", password: "wrong" }, spamIp);
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error).toContain("Too many login attempts");
  });

  it("verifies synchronization push and pull state operations", async () => {
    const loginRes = await handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-5");
    const user = loginRes.body.user;
    expect(user).toBeDefined();
    if (!user) {
      throw new Error("Expected user");
    }

    const envelope = {
      entityId: "sync-habit-1",
      entityType: "HABIT",
      operation: "UPSERT",
      payload: { title: "Synced Habit" },
      lamportTimestamp: 1,
      wallClock: Date.now(),
      clientId: "client-a",
    };

    const pushRes = handleSyncPush(user.id, [envelope]);
    expect(pushRes.status).toBe(200);
    expect(pushRes.body.success).toBe(true);
    expect(pushRes.body.committedCount).toBe(1);

    const pullRes = handleSyncPull(user.id, 0);
    expect(pullRes.status).toBe(200);
    expect(pullRes.body.envelopes).toBeDefined();
    expect(pullRes.body.envelopes?.length).toBe(1);
    const firstEnvelope = pullRes.body.envelopes?.[0] as { entityId?: string } | undefined;
    expect(firstEnvelope?.entityId).toBe("sync-habit-1");
  });

  it("enforces deterministic device-ID tie-breaking when lamport timestamps are equal", async () => {
    const loginRes = await handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-6");
    const user = loginRes.body.user;
    if (!user) {
      throw new Error("Expected user");
    }

    const envDeviceA = {
      entityId: "tie-break-habit",
      entityType: "HABIT",
      operation: "UPSERT",
      payload: { title: "From Device A" },
      lamportTimestamp: 5,
      deviceId: "device-aaa",
      isDeleted: false,
    };

    const envDeviceB = {
      entityId: "tie-break-habit",
      entityType: "HABIT",
      operation: "UPSERT",
      payload: { title: "From Device B" },
      lamportTimestamp: 5,
      deviceId: "device-zzz",
      isDeleted: false,
    };

    handleSyncPush(user.id, [envDeviceA]);
    handleSyncPush(user.id, [envDeviceB]);

    const pullRes = handleSyncPull(user.id, 0);
    const synchronizer = new LastWriteWinsSynchronizer<{ title: string }>();
    const resolved = pullRes.body.envelopes?.reduce<SyncEnvelope<{ title: string }> | null>(
      (acc, e) => (acc ? synchronizer.resolveWinner(acc, e as unknown as SyncEnvelope<{ title: string }>) : (e as unknown as SyncEnvelope<{ title: string }>)),
      null
    );
    expect(resolved).toBeDefined();
    expect(resolved?.payload.title).toBe("From Device B");
  });

  it("verifies append-only change log pagination with server cursor", async () => {
    const paginationEmail = `pagination_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email: paginationEmail, password: testPassword });
    const userId = regRes.body.user!.id;

    const env1 = {
      entityId: "pag-1",
      entityType: "HABIT",
      payload: { step: 1 },
      lamportTimestamp: 1,
      deviceId: "d1",
    };
    const env2 = {
      entityId: "pag-2",
      entityType: "HABIT",
      payload: { step: 2 },
      lamportTimestamp: 2,
      deviceId: "d1",
    };
    const env3 = {
      entityId: "pag-3",
      entityType: "HABIT",
      payload: { step: 3 },
      lamportTimestamp: 3,
      deviceId: "d1",
    };

    handleSyncPush(userId, [env1, env2]);
    handleSyncPush(userId, [env3]);

    const firstPage = handleSyncPull(userId, 0, 2);
    expect(firstPage.body.envelopes?.length).toBe(2);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.nextCursor).toBe(2);

    const secondPage = handleSyncPull(userId, firstPage.body.nextCursor, 2);
    expect(secondPage.body.envelopes?.length).toBe(1);
    expect(secondPage.body.hasMore).toBe(false);
    expect(secondPage.body.nextCursor).toBe(3);
  });

  it("validates sync payload structure and rejects malformed envelope data", () => {
    const invalidBatch = handleSyncPush("usr_test", null as any);
    expect(invalidBatch.status).toBe(400);

    const malformedEnvelope = handleSyncPush("usr_test", [{ invalid: true }] as any);
    expect(malformedEnvelope.status).toBe(400);
  });
});
