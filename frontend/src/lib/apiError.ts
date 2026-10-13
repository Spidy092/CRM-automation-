/**
 * Extracts a human-readable message from a failed API call for use in toasts.
 * The backend error envelope is `{ success: false, error: <string> }`, surfaced
 * by axios at `error.response.data.error`. Falls back to the provided message
 * when no specific detail is available.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function getApiErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export interface FileReferenceInfo {
  id: string;
  name?: string;
  title?: string;
}

export interface FileReferencesMeta {
  templates: FileReferenceInfo[];
  pages: FileReferenceInfo[];
}

/** Structured `meta.references` from a 409 file-delete conflict (absent for other errors). */
export function getApiErrorReferences(error: unknown): FileReferencesMeta | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as { response?: { data?: { meta?: { references?: unknown } } } })?.response?.data?.meta?.references;
  if (typeof data !== 'object' || data === null) return undefined;
  const { templates, pages } = data as { templates?: unknown; pages?: unknown };
  if (!Array.isArray(templates) || !Array.isArray(pages)) return undefined;
  return { templates: templates as FileReferenceInfo[], pages: pages as FileReferenceInfo[] };
}
