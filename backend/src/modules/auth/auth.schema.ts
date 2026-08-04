import { z } from 'zod';

/**
 * Common weak passwords and patterns that should be rejected even if they
 * meet the structural rules (length, uppercase, number). Derived from the
 * NIST SP 800-63B banned-password list.
 */
const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123',
  'passw0rd', 'passw0rd1', 'passw0rd12',
  'changeme', 'changeme1', 'changeme12',
  'letmein', 'letmein1', 'letmein12',
  'welcome', 'welcome1', 'welcome12',
  'admin', 'admin1', 'admin12', 'admin123',
  'qwerty', 'qwerty1', 'qwerty12', 'qwerty123',
  'abc123', 'abc1234', 'abcdef',
  'monkey', 'dragon', 'master', 'login',
  'princess', 'football', 'shadow', 'sunshine',
  'trustno1', 'iloveyou', 'batman',
  'access', 'hello', 'charlie', 'donald',
  'test', 'test1', 'test12', 'testing',
  'summer', 'winter', 'spring', 'fall',
  'company', 'secret', 'p@ssword', 'p@ssw0rd',
  'pass!', 'pass123', 'pass1234',
  '123456', '1234567', '12345678', '123456789', '1234567890',
]);

/**
 * Regex that detects keyboard-walk patterns like "qwerty", "asdfgh",
 * "zxcvbn", "1qaz2wsx", etc.
 */
const KEYBOARD_WALK_RE = /(?:qwerty|asdfgh|zxcvbn|qazwsx|1qaz2wsx|zaq1!qaz)/i;

/**
 * Regex that detects repeated characters like "aaa", "111", "ababab".
 */
const REPEATED_CHAR_RE = /(.)\1{2,}|^(.)\2+$/;

/**
 * Shared password validation rules enforced on create-user and reset-password.
 * The login schema intentionally stays permissive (min 1) — the auth service
 * handles lockout and timing-safe comparison.
 */
const passwordRules = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .refine(
    (val) => !COMMON_WEAK_PASSWORDS.has(val.toLowerCase()),
    'Password is too common — choose a stronger password',
  )
  .refine(
    (val) => !KEYBOARD_WALK_RE.test(val),
    'Password contains a keyboard pattern — choose a stronger password',
  )
  .refine(
    (val) => !REPEATED_CHAR_RE.test(val),
    'Password contains too many repeated characters',
  );

export { passwordRules };

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: passwordRules,
});

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  expiresInDays: z.number().int().positive().optional(),
});
