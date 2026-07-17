/**
 * Telegram Bot connector.
 *
 * Auth: Bot token embedded in URL path
 * Credentials shape: { botToken: string, defaultChatId?: string }
 *
 * Vendor docs: https://core.telegram.org/bots/api
 * Base URL: https://api.telegram.org/bot<token>
 */

import { z } from 'zod';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';

export const TELEGRAM_PROVIDER_NAME = 'telegram';

export const telegramCredentialsSchema = z
  .object({
    botToken:      z.string().min(1, 'Bot token is required'),
    defaultChatId: z.string().optional(),
  })
  .strict();

export type TelegramCredentials = z.infer<typeof telegramCredentialsSchema>;

function botBase(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

export async function loadCredentials(): Promise<TelegramCredentials> {
  const row = await findByName(TELEGRAM_PROVIDER_NAME);
  if (!row) throw new AppError('Telegram integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Telegram credentials not set', 422);
  const raw = JSON.parse(decrypt(enc)) as unknown;
  const result = telegramCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(`Telegram credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`, 422);
  }
  return result.data;
}

/**
 * Calls getMe — a zero-side-effect endpoint that returns the bot's own profile.
 */
export async function testConnection(
  creds: TelegramCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number; botUsername?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${botBase(creds.botToken)}/getMe`);
    const body = await res.json() as { ok: boolean; result?: { username?: string }; description?: string };
    if (body.ok) {
      return { ok: true, latencyMs: Date.now() - start, botUsername: body.result?.username };
    }
    return { ok: false, error: body.description ?? 'Telegram getMe failed', latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error', latencyMs: Date.now() - start };
  }
}

export interface SendTelegramMessageInput {
  leadId: string;
  campaignId?: string | null;
  chatId: string;
  text: string;
  parseMode?: 'Markdown' | 'HTML';
}

export interface SendTelegramMessageOutput {
  messageId: number;
  latencyMs: number;
}

/**
 * Sends a text message via the Telegram Bot API.
 */
export async function sendMessage(
  input: SendTelegramMessageInput,
): Promise<{ ok: boolean; data?: SendTelegramMessageOutput; error?: string }> {
  const creds = await loadCredentials();
  const start = Date.now();
  try {
    const res = await fetch(`${botBase(creds.botToken)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    input.chatId,
        text:       input.text,
        parse_mode: input.parseMode ?? 'Markdown',
      }),
    });
    const body = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
    if (body.ok && body.result) {
      return { ok: true, data: { messageId: body.result.message_id, latencyMs: Date.now() - start } };
    }
    return { ok: false, error: body.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Gets updates (incoming messages) from the bot since a given offset.
 * Used for reply tracking — call periodically or from a webhook.
 */
export async function getUpdates(
  offset?: number,
): Promise<Array<{ updateId: number; message?: { chatId: number; text?: string; from?: { username?: string } } }>> {
  const creds = await loadCredentials();
  const params = new URLSearchParams({ timeout: '0', limit: '100' });
  if (offset != null) params.set('offset', String(offset));
  try {
    const res = await fetch(`${botBase(creds.botToken)}/getUpdates?${params.toString()}`);
    const body = await res.json() as { ok: boolean; result?: Array<{ update_id: number; message?: { chat: { id: number }; text?: string; from?: { username?: string } } }> };
    if (!body.ok || !body.result) return [];
    return body.result.map((u) => ({
      updateId: u.update_id,
      message: u.message
        ? { chatId: u.message.chat.id, text: u.message.text, from: u.message.from }
        : undefined,
    }));
  } catch {
    return [];
  }
}
