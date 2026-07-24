import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  findMessageSnippetById,
  findMessageSnippets,
  insertMessageSnippet,
  softDeleteMessageSnippet,
  updateMessageSnippet as updateMessageSnippetRepo,
} from './messages.repository';
import {
  MessageSnippetActor,
  MessageSnippetInput,
  MessageSnippetListFilters,
  MessageSnippetResponse,
} from './messages.types';

export async function listMessageSnippets(
  filters: MessageSnippetListFilters,
): Promise<MessageSnippetResponse[]> {
  return findMessageSnippets(filters);
}

export async function getMessageSnippet(id: string): Promise<MessageSnippetResponse> {
  const row = await findMessageSnippetById(id);
  if (!row) throw new AppError('Message snippet not found', 404);
  return row;
}

export async function createMessageSnippet(
  input: MessageSnippetInput,
  actor: MessageSnippetActor,
): Promise<MessageSnippetResponse> {
  const row = await insertMessageSnippet({
    title: input.title,
    channel: input.channel ?? null,
    body: input.body,
    variables: input.variables ?? [],
    file_ids: input.file_ids ?? [],
    created_by: actor.id,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'message_snippet.created',
    entityType: 'message_snippet',
    entityId: row.id,
    newValue: { title: row.title, channel: row.channel },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function updateMessageSnippet(
  id: string,
  input: Partial<MessageSnippetInput>,
  actor: MessageSnippetActor,
): Promise<MessageSnippetResponse> {
  const before = await findMessageSnippetById(id);
  if (!before) throw new AppError('Message snippet not found', 404);

  const row = await updateMessageSnippetRepo(id, {
    title: input.title,
    channel: input.channel,
    body: input.body,
    variables: input.variables,
    file_ids: input.file_ids,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'message_snippet.updated',
    entityType: 'message_snippet',
    entityId: id,
    oldValue: { title: before.title },
    newValue: { title: row.title },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function removeMessageSnippet(id: string, actor: MessageSnippetActor): Promise<void> {
  const before = await findMessageSnippetById(id);
  if (!before) throw new AppError('Message snippet not found', 404);

  await softDeleteMessageSnippet(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'message_snippet.deleted',
    entityType: 'message_snippet',
    entityId: id,
    oldValue: { title: before.title },
    ipAddress: actor.ipAddress ?? null,
  });
}
