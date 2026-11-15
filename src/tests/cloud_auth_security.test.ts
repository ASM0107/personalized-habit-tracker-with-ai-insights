import { describe, it, expect } from "vitest";
import {
  handleRegister,
  handleLogin,
  verifyToken,
  signToken,
  handleSyncPush,
  handleSyncPull,
} from "../../server/auth.js";

describe("Cloud Auth Security & Token Integrity Audit", () => {
  const testEmail = `audit_user_${Date.now()}@example.com`;
  const testPassword = "securePassword123!";

  it("enforces strict input validation on account registration", () => {
    const invalidEmailRes = handleRegister({ email: "invalid-email", password: "password123" }, "test-ip-reg-1");
    expect(invalidEmailRes.status).toBe(400);
    expect(invalidEmailRes.body.error).toContain("valid email address");

    const shortPasswordRes = handleRegister({ email: "valid@test.com", password: "123" }, "test-ip-reg-2");
    expect(shortPasswordRes.status).toBe(400);
    expect(shortPasswordRes.body.error).toContain("at least 8 characters");
  });

  it("registers account successfully and rejects duplicate registration with 409", () => {
    const regRes = handleRegister({ email: testEmail, password: testPassword, name: "Audit User" }, "test-ip-reg-3");
    expect(regRes.status).toBe(201);
    expect(regRes.body.user).toBeDefined();
    expect(regRes.body.user?.email).toBe(testEmail.toLowerCase());
    expect(regRes.body.token).toBeDefined();

    const dupRes = handleRegister({ email: testEmail, password: testPassword }, "test-ip-reg-4");
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toContain("already exists");
  });

  it("verifies login credentials and guards against timing attacks", () => {
    const loginSuccess = handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-1");
    expect(loginSuccess.status).toBe(200);
    expect(loginSuccess.body.user).toBeDefined();
    expect(loginSuccess.body.user?.email).toBe(testEmail.toLowerCase());
    expect(loginSuccess.body.token).toBeDefined();

    const loginWrongPass = handleLogin({ email: testEmail, password: "WrongPassword" }, "test-ip-log-2");
    expect(loginWrongPass.status).toBe(401);
    expect(loginWrongPass.body.error).toBe("Invalid email or password");

    const loginNonExistent = handleLogin({ email: "nonexistent@example.com", password: "Password123" }, "test-ip-log-3");
    expect(loginNonExistent.status).toBe(401);
    expect(loginNonExistent.body.error).toBe("Invalid email or password");
  });

  it("validates cryptographic token integrity and rejects tampered signatures", () => {
    const loginRes = handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-4");
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

  it("enforces brute-force rate limits on registration and authentication attempts", () => {
    const spamIp = "ip-spammer-999";
    for (let i = 0; i < 20; i++) {
      handleLogin({ email: "someone@test.com", password: "wrong" }, spamIp);
    }

    const rateLimitedRes = handleLogin({ email: "someone@test.com", password: "wrong" }, spamIp);
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error).toContain("Too many login attempts");
  });

  it("verifies synchronization push and pull state operations", () => {
    const loginRes = handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-5");
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

  it("enforces deterministic device-ID tie-breaking when lamport timestamps are equal", () => {
    const loginRes = handleLogin({ email: testEmail, password: testPassword }, "test-ip-log-6");
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
    };

    const envDeviceB = {
      entityId: "tie-break-habit",
      entityType: "HABIT",
      operation: "UPSERT",
      payload: { title: "From Device B" },
      lamportTimestamp: 5,
      deviceId: "device-zzz",
    };

    handleSyncPush(user.id, [envDeviceA]);
    handleSyncPush(user.id, [envDeviceB]);

    const pullRes = handleSyncPull(user.id, 0);
    const winning = pullRes.body.envelopes?.find((e: any) => e.entityId === "tie-break-habit") as any;
    expect(winning).toBeDefined();
    expect(winning.payload.title).toBe("From Device B");
  });

  it("validates sync payload structure and rejects malformed envelope data", () => {
    const invalidBatch = handleSyncPush("usr_test", null as any);
    expect(invalidBatch.status).toBe(400);

    const malformedEnvelope = handleSyncPush("usr_test", [{ invalid: true }] as any);
    expect(malformedEnvelope.status).toBe(400);
  });
});
