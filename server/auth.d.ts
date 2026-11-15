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
    readonly serverLamportTimestamp?: number;
    readonly error?: string;
  };
}

export interface PullResult {
  readonly status: number;
  readonly body: {
    readonly envelopes?: readonly unknown[];
    readonly latestServerTimestamp?: number;
    readonly error?: string;
  };
}

export function handleRegister(payload: { email?: string; password?: string; name?: string }): RegisterResult;
export function handleLogin(payload: { email?: string; password?: string }): LoginResult;
export function verifyToken(rawToken: string): { id: string; email: string; name: string; createdAt: number } | null;
export function handleSyncPush(userId: string, envelopes: unknown[]): PushResult;
export function handleSyncPull(userId: string, sinceLamport?: number): PullResult;
