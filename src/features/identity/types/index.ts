export type AccountType = "LOCAL" | "CLOUD";

export interface UserProfile {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly email?: string;
  readonly avatarColor: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly token?: string;
}

export interface RegisterInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthSessionResponse {
  readonly user: UserProfile;
  readonly token: string;
  readonly error?: string;
}
