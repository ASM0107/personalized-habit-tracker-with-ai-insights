export interface CloudUserSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly type: "CLOUD";
  readonly createdAt: number;
}

export interface RegisterResult {
  readonly status: number;
  readonly body: {
    readonly user?: CloudUserSummary;
    readonly token?: string;
    readonly error?: string;
  };
}

export interface LoginResult {
  readonly status: number;
  readonly body: {
    readonly user?: CloudUserSummary;
    readonly token?: string;
    readonly error?: string;
  };
}

export interface PushResult {
  readonly status: number;
  readonly body: {
    readonly success?: boolean;
    readonly committedCount?: number;
    readonly newlyCommittedCount?: number;
    readonly serverCursor?: number;
    readonly serverLamportTimestamp?: number;
    readonly error?: string;
  };
}

export interface PullResult {
  readonly status: number;
  readonly body: {
    readonly envelopes?: readonly unknown[];
    readonly changes?: readonly unknown[];
    readonly materialized?: readonly unknown[];
    readonly latestServerTimestamp?: number;
    readonly latestServerCursor?: number;
    readonly nextCursor?: number;
    readonly hasMore?: boolean;
    readonly error?: string;
  };
}

export interface MaterializedResult {
  readonly status: number;
  readonly body: {
    readonly entities?: readonly unknown[];
    readonly latestServerCursor?: number;
    readonly error?: string;
  };
}

export interface TokenPayload {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly ts?: number;
  readonly createdAt?: number;
}

export function signToken(user: { id: string; email: string; name: string; createdAt?: number }, customTimestamp?: number): string;
export function handleRegister(payload: { email?: string; password?: string; name?: string }, clientIp?: string): Promise<RegisterResult>;
export function handleLogin(payload: { email?: string; password?: string }, clientIp?: string): Promise<LoginResult>;
export function verifyToken(rawToken: string): TokenPayload | null;
export function handleSyncPush(userId: string, envelopes: unknown[]): PushResult;
export function handleSyncPull(userId: string, sinceCursor?: number, limit?: number): PullResult;
export function handleSyncGetMaterialized(userId: string): MaterializedResult;
