import { UserRole } from '../../shared/types';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
}

export interface RefreshInput {
  refreshToken: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_available: boolean;
  is_active: boolean;
  failed_login_attempts?: number;
  locked_until?: Date | null;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  prefix: string;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface CreateApiKeyResult {
  rawKey: string;
  apiKey: ApiKeyRecord;
}

/** Shape returned by listApiKeys — excludes the hash for security. */
export type ApiKeyListItem = Pick<ApiKeyRecord, 'id' | 'name' | 'prefix' | 'last_used_at' | 'expires_at' | 'created_at'>;

/** User identity extracted from a validated API key. */
export interface ApiKeyIdentity {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

/** Raw row from the api_keys JOIN users query used by findApiKeyByHash. */
export interface ApiKeyRecordRow {
  id: string;
  user_id: string;
  expires_at: Date | string | null;
  deleted_at: Date | string | null;
  u_id: string;
  email: string;
  role: UserRole;
  name: string;
  is_active: boolean;
}
