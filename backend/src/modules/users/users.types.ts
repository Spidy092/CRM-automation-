import { UserRole } from '../../shared/types';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
}

export interface UpdateProfileInput {
  name: string;
}

export interface UpdatePermissionsInput {
  role?: UserRole;
  is_active?: boolean;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  is_active: boolean;
}
