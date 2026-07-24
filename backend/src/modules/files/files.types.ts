/** Raw row shape from the `files` table. */
export interface FileRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  url: string;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** File API response shape — `storage_path` is server-only and never sent to the client. */
export interface FileResponse {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FileActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export interface UpdateFileInput {
  filename?: string;
  tags?: string[];
}
