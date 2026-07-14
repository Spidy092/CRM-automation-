import multer from 'multer';

/**
 * In-memory file upload for lead CSV/XLSX imports.
 *
 * Security: enforces a 10MB size limit (TRD §10.4). Content-type / extension
 * validation is performed in the handler so we can return a clean 400 instead
 * of relying on multer's fileFilter (which would surface as a 500).
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

export const leadImportUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
});

/**
 * In-memory upload for template attachments (images/PDFs sent alongside
 * WhatsApp/email messages). Kept in memory — the service layer writes the
 * buffer to disk itself so it controls the filename and storage path.
 * Content-type validation happens in the handler, same rationale as above.
 */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export const templateAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES },
});
