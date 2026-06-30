/**
 * Extracts a human-readable message from a failed API call for use in toasts.
 * The backend error envelope is `{ success: false, error: <string> }`, surfaced
 * by axios at `error.response.data.error`. Falls back to the provided message
 * when no specific detail is available.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}
