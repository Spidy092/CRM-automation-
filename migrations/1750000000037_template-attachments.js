/**
 * Migration 0037: Template attachments.
 *
 * Adds an `attachments` column to `templates` so a template can carry one or
 * more files (images/PDFs) alongside its text body — sent as email
 * attachments, WhatsApp media, etc. Stored as a JSONB array of:
 *   { id, filename, mimeType, sizeBytes, url, storagePath }
 * `storagePath` is server-only (absolute path on disk) and is stripped
 * before the API response is sent to the frontend.
 */

exports.up = async (pgm) => {
  pgm.addColumn('templates', {
    attachments: { type: 'jsonb', notNull: true, default: '[]' },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumn('templates', 'attachments');
};
