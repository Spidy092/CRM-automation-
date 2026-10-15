import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../Toast';

function ToastTrigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('Saved')}>Show notification</button>;
}

describe('ToastProvider timer lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('removes a notification after four seconds', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Show notification' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Saved');

    act(() => vi.advanceTimersByTime(4000));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels notification timers when the provider unmounts', () => {
    const { unmount } = render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Show notification' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show notification' }));
    expect(vi.getTimerCount()).toBe(2);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a notification timer when manually dismissed', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Show notification' }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
