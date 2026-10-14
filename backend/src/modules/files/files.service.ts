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
import { advisoryLockKey, withAdvisoryLock } from '../../shared/utils/db';
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

/**
 * Stored file URLs bake in the public base URL at upload time. When neither
 * APP_BASE_URL nor BASE_URL is set, uploads get `http://localhost:3000/...`
 * URLs that break for any browser client not running on the server itself
 * (the reported broken-thumbnail source). Warn once per upload so the
 * misconfiguration is visible in logs instead of surfacing only as dead images.
 */
function warnIfLocalUploadBase(): void {
  if (!process.env.APP_BASE_URL && !process.env.BASE_URL) {
    logger.warn(
      'APP_BASE_URL is not set — stored file URLs will use http://localhost:3000 and may not load for browser clients on other hosts. Set APP_BASE_URL to the public backend origin.',
    );
  }
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

export async function listFiles(filters: {
  tag?: string;
  search?: string;
}): Promise<FileResponse[]> {
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
  warnIfLocalUploadBase();
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

/**
 * Reference reads for the file-lifecycle protocol, owned by the modules that
 * own the data — never their repositories. Importing the templates/pages
 * repositories here would break the module boundary rule, and importing their
 * services would cycle back through this module (both consume
 * getFileRow/getFile). Implementations are injected once at the composition
 * root (files.controller, next to the only production caller of removeFile);
 * tests inject fakes directly.
 */
export interface FileReferenceCheckers {
  findTemplatesUsingFile: (fileId: string) => Promise<Array<{ id: string; name: string }>>;
  findPagesUsingFile: (fileId: string) => Promise<Array<{ id: string; title: string }>>;
}

let referenceCheckers: FileReferenceCheckers | null = null;

export function setFileReferenceCheckers(checkers: FileReferenceCheckers): void {
  referenceCheckers = checkers;
}

function getFileReferenceCheckers(): FileReferenceCheckers {
  if (!referenceCheckers) {
    logger.error('file reference checkers are not configured — refusing to delete');
    throw new AppError('File reference validation is not configured', 500);
  }
  return referenceCheckers;
}

export async function removeFile(id: string, actor: FileActor): Promise<void> {
  const checkers = getFileReferenceCheckers();

  // File-lifecycle protocol: deletion and "attach from library" serialize on
  // the same advisory lock for this file id. The reference re-check, the live
  // row re-read, and the soft-delete all run inside the lock, so a concurrent
  // attach either completes first (and is then seen by the re-check → 409) or
  // runs after the soft-delete commits (and sees the row as gone → 404).
  // Without this, check-then-act interleavings orphan template attachments
  // pointing at an unlinked disk file, failing future sends.
  const deleted = await withAdvisoryLock(advisoryLockKey('file-lifecycle', id), async () => {
    const before = await findFileById(id);
    if (!before) throw new AppError('File not found', 404);
    const [templates, pages] = await Promise.all([
      checkers.findTemplatesUsingFile(id),
      checkers.findPagesUsingFile(id),
    ]);
    if (templates.length > 0 || pages.length > 0) {
      const parts: string[] = [];
      if (templates.length > 0) {
        parts.push(
          `${templates.length} template${templates.length === 1 ? '' : 's'} (${templates
            .slice(0, 5)
            .map((t) => `"${t.name}"`)
            .join(', ')}${templates.length > 5 ? ', …' : ''})`,
        );
      }
      if (pages.length > 0) {
        parts.push(
          `${pages.length} landing page${pages.length === 1 ? '' : 's'} (${pages
            .slice(0, 5)
            .map((p) => `"${p.title}"`)
            .join(', ')}${pages.length > 5 ? ', …' : ''})`,
        );
      }
      throw new AppError(
        `Cannot delete "${before.filename}" — it is still used by ${parts.join(' and ')}. Remove it from those items first, then delete.`,
        409,
        { references: { templates, pages } },
      );
    }

    await softDeleteFile(id);
    return { storagePath: before.storage_path, filename: before.filename };
  });

  // Filesystem work cannot roll back, so it runs after the lock commits.
  // A concurrent attach landing here sees the soft-deleted row as gone.
  await unlink(deleted.storagePath).catch((err) =>
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
    oldValue: { filename: deleted.filename },
    ipAddress: actor.ipAddress ?? null,
  });
}
