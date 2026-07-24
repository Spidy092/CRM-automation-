import { z } from 'zod';
import { MessageChannel } from '../../shared/types';

const channelEnum = z.enum(['whatsapp', 'email', 'sms', 'phone_call']) as z.ZodEnum<
  [MessageChannel, ...MessageChannel[]]
>;

export const messageSnippetIdParamSchema = z.object({
  id: z.string().uuid('Message snippet id must be a valid UUID'),
});

const baseMessageSnippetSchema = z.object({
  title: z.string().min(1, 'title is required').max(255),
  channel: channelEnum.optional().nullable(),
  body: z.string().min(1, 'body is required'),
  variables: z.array(z.string()).optional(),
  file_ids: z.array(z.string().uuid()).optional(),
});

export const createMessageSnippetSchema = baseMessageSnippetSchema;

export const updateMessageSnippetSchema = baseMessageSnippetSchema.partial();

export const listMessageSnippetsQuerySchema = z.object({
  channel: channelEnum.optional(),
  search: z.string().max(255).optional(),
});

export type CreateMessageSnippetInput = z.infer<typeof createMessageSnippetSchema>;
export type UpdateMessageSnippetInput = z.infer<typeof updateMessageSnippetSchema>;
