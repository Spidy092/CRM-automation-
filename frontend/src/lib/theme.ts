export type Theme = 'light' | 'dark' | 'system';

/**
 * Applies the given theme to the document root element (<html>) by adding or
 * removing the 'dark' CSS class used by Tailwind dark mode tokens.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    // 'system' — match OS color scheme preference
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

/**
 * Reads saved theme preference from localStorage and applies it on app launch.
 */
export function initTheme(): void {
  try {
    const raw = localStorage.getItem('crm_preferences');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.theme) {
        applyTheme(parsed.theme as Theme);
        return;
      }
    }
  } catch {
    // ignore parse error
  }
  applyTheme('system');
}
