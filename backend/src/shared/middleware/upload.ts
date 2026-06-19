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
