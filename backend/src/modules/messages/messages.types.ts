import { MessageChannel } from '../../shared/types';

/** Raw row shape from the `message_snippets` table. */
export interface MessageSnippetRow {
  id: string;
  title: string;
  channel: MessageChannel | null;
  body: string;
  variables: string[];
  file_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Message snippet API response shape (currently identical to the row — no server-only fields). */
export type MessageSnippetResponse = MessageSnippetRow;

export interface MessageSnippetInput {
  title: string;
  channel?: MessageChannel | null;
  body: string;
  variables?: string[];
  file_ids?: string[];
}

export interface MessageSnippetListFilters {
  channel?: MessageChannel;
  search?: string;
}

export interface MessageSnippetActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}
