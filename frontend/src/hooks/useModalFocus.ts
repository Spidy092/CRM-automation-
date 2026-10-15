import { useEffect, useRef, type RefObject } from 'react';

/** Keep keyboard focus in an open modal and restore its opener on unmount. */
export function useModalFocus(onClose: () => void): RefObject<HTMLDivElement> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const controls = (): HTMLElement[] => Array.from(dialog?.querySelectorAll<HTMLElement>('*') ?? [])
      .filter((element) => element.matches('button, [href], input, select, textarea, iframe, [tabindex]') &&
        !element.matches(':disabled, input[type="hidden"]') &&
        !element.closest('[hidden], [aria-hidden="true"]') && element.getAttribute('tabindex') !== '-1');
    dialog?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog?.focus(); return; }
      if (!dialog?.contains(document.activeElement) || document.activeElement === dialog ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus(); };
  }, []);
  return dialogRef;
}
