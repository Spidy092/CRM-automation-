import { randomUUID } from 'crypto';
import { unlink, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  findFileById,
  findFiles,
  insertFile,
  softDeleteFile,
  updateFile as updateFileRepo,
} from './files.repository';
import { FileActor, FileResponse, FileRow, UpdateFileInput } from './files.types';

const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads/files');
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
// Client-supplied mimetype (from the multipart Content-Type field) is not
// trustworthy on its own — it can be set to anything by the uploader. Cross-check
// the on-disk extension against the same allowlist so a spoofed mimetype can't
// land an executable file (e.g. `.php`, `.exe`) inside the served /uploads dir.
const ALLOWED_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
};

function publicBaseUrl(): string {
  return process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
}

function toResponse(row: FileRow): FileResponse {
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    url: row.url,
    tags: row.tags ?? [],
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listFiles(filters: { tag?: string; search?: string }): Promise<FileResponse[]> {
  const rows = await findFiles(filters);
  return rows.map(toResponse);
}

export async function getFile(id: string): Promise<FileResponse> {
  const row = await findFileById(id);
  if (!row) throw new AppError('File not found', 404);
  return toResponse(row);
}

/**
 * Internal accessor for other backend modules that legitimately need the
 * disk path (e.g. templates referencing a library file for outbound
 * SMTP/SendGrid dispatch) — never expose `storage_path` over HTTP.
 */
export async function getFileRow(id: string): Promise<FileRow> {
  const row = await findFileById(id);
  if (!row) throw new AppError('File not found', 404);
  return row;
}

export async function uploadFile(
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  actor: FileActor,
): Promise<FileResponse> {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new AppError(
      `Unsupported file type "${file.mimetype}". Allowed: PNG, JPEG, WEBP, GIF, PDF.`,
      400,
    );
  }

  const ext = (path.extname(file.originalname) || '').toLowerCase();
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME[file.mimetype] ?? [];
  if (!allowedExtensions.includes(ext)) {
    throw new AppError(
      `File extension "${ext}" does not match declared type "${file.mimetype}".`,
      400,
    );
  }

  const fileId = randomUUID();
  const diskFilename = `${fileId}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storagePath = path.join(UPLOAD_DIR, diskFilename);
  await writeFile(storagePath, file.buffer);

  const row = await insertFile({
    filename: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    storage_path: storagePath,
    url: `${publicBaseUrl()}/uploads/files/${diskFilename}`,
    created_by: actor.id,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'file.uploaded',
    entityType: 'file',
    entityId: row.id,
    newValue: { filename: row.filename, mimeType: row.mime_type },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

export async function updateFile(
  id: string,
  input: UpdateFileInput,
  actor: FileActor,
): Promise<FileResponse> {
  const before = await findFileById(id);
  if (!before) throw new AppError('File not found', 404);

  const row = await updateFileRepo(id, input);

  await writeAuditLog({
    userId: actor.id,
    action: 'file.updated',
    entityType: 'file',
    entityId: id,
    oldValue: { filename: before.filename, tags: before.tags },
    newValue: { filename: row.filename, tags: row.tags },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

export async function removeFile(id: string, actor: FileActor): Promise<void> {
  const before = await findFileById(id);
  if (!before) throw new AppError('File not found', 404);

  await softDeleteFile(id);

  await unlink(before.storage_path).catch((err) =>
    logger.warn('failed to delete library file from disk', {
      fileId: id,
      error: (err as Error).message,
    }),
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'file.deleted',
    entityType: 'file',
    entityId: id,
    oldValue: { filename: before.filename },
    ipAddress: actor.ipAddress ?? null,
  });
}
