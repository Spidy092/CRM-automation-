import { z } from 'zod';

/**
 * Per-number runtime state for anti-ban.
 */
export interface OpenWANumberConfig {
  /** The sender phone number (E.164 or WhatsApp identifier). */
  number: string;
  /** Messages sent today for this number. */
  dailyCount: number;
  /** Messages sent in the current hour for this number. */
  hourlyCount: number;
  /** ISO timestamp of the last message sent, or null if never used. */
  lastSentAt: string | null;
  /** Messages already sent during the warm-up phase. */
  warmupSent: number;
  /** ISO timestamp until which the number is cooling down, or null. */
  cooldownUntil: string | null;
}

export const openWANumberConfigSchema: z.ZodType<OpenWANumberConfig> = z.object({
  number: z.string().min(1),
  dailyCount: z.number().int().min(0),
  hourlyCount: z.number().int().min(0),
  lastSentAt: z.string().datetime().nullable(),
  warmupSent: z.number().int().min(0),
  cooldownUntil: z.string().datetime().nullable(),
});

/**
 * Anti-ban configuration stored inside integration credentials JSONB.
 */
export interface AntiBanConfig {
  /** Maximum messages per hour across all numbers. */
  rateLimitPerHour: number;
  /** Maximum messages per day across all numbers. */
  rateLimitPerDay: number;
  /** Minimum jitter delay between sends, in milliseconds. */
  jitterMinMs: number;
  /** Maximum jitter delay between sends, in milliseconds. */
  jitterMaxMs: number;
  /** Maximum messages during the warm-up window for a number. */
  warmupMax: number;
  /** Cooldown duration in minutes when a limit is hit. */
  cooldownMinutes: number;
  /** Whether anti-ban protections are active. */
  enabled: boolean;
}

export const antiBanConfigSchema: z.ZodType<AntiBanConfig> = z.object({
  rateLimitPerHour: z.number().int().min(1),
  rateLimitPerDay: z.number().int().min(1),
  jitterMinMs: z.number().int().min(0),
  jitterMaxMs: z.number().int().min(0),
  warmupMax: z.number().int().min(0),
  cooldownMinutes: z.number().int().min(0),
  enabled: z.boolean(),
});

/**
 * Top-level credential envelope for the OpenWA integration.
 */
export interface OpenWACredentials {
  /** Base URL of the OpenWA HTTP server. */
  baseUrl: string;
  /** API key or session secret used for authentication. */
  apiKey: string;
  /** OpenWA session identifier. */
  sessionId: string;
  /** Sender numbers available for rotation. */
  numbers: string[];
  /** Optional anti-ban configuration. */
  antiBan?: AntiBanConfig;
}

export const openWACredentialsSchema: z.ZodType<OpenWACredentials> = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  sessionId: z.string().min(1),
  numbers: z.array(z.string().min(1)),
  antiBan: antiBanConfigSchema.optional(),
});

/**
 * Runtime type guard for OpenWA credentials.
 *
 * @param value - Any value to validate.
 * @returns True when the value matches the OpenWACredentials shape.
 */
export function isOpenWACredentials(value: unknown): value is OpenWACredentials {
  return openWACredentialsSchema.safeParse(value).success;
}

/**
 * Payload sent to OpenWA `/api/sessions/:session/messages/send-text`.
 */
export interface OpenWASendRequest {
  /** Target chat identifier (e.g. `123456789@c.us`). */
  chatId: string;
  /** Message body text. */
  text: string;
}

export const openWASendRequestSchema: z.ZodType<OpenWASendRequest> = z.object({
  chatId: z.string().min(1),
  text: z.string().min(1),
});

/**
 * Minimal success response from OpenWA after sending a message.
 */
export interface OpenWASendResponse {
  /** External message identifier returned by OpenWA. */
  messageId: string;
  /** Unix timestamp (milliseconds) of the sent message. */
  timestamp: number;
}

export const openWASendResponseSchema: z.ZodType<OpenWASendResponse> = z.object({
  messageId: z.string().min(1),
  timestamp: z.number().int(),
});

/**
 * Minimal health/status response from OpenWA.
 */
export interface OpenWAHealthResponse {
  /** Status string returned by the server (e.g. "OK", "SCAN_QR_CODE"). */
  status: string;
  /** Session identifier, if returned by the server. */
  session?: string;
  /** Error message, when the health check reports a failure. */
  error?: string;
}

export const openWAHealthResponseSchema: z.ZodType<OpenWAHealthResponse> = z.object({
  status: z.string().min(1),
  session: z.string().optional(),
  error: z.string().optional(),
});
