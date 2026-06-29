import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { LoginIllustration } from '../LoginIllustration';

describe('LoginIllustration', () => {
  it('renders an svg element', () => {
    const { container } = renderWithProviders(<LoginIllustration />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('uses currentColor for strokes (themeable)', () => {
    const { container } = renderWithProviders(<LoginIllustration />);
    const strokedElements = container.querySelectorAll('[stroke="currentColor"]');
    expect(strokedElements.length).toBeGreaterThan(0);
  });

  it('is decorative (aria-hidden)', () => {
    const { container } = renderWithProviders(<LoginIllustration />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
