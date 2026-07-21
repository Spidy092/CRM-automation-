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
