import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColumnSettings } from '@/components/ui/ColumnSettings';

const OPTIONS = [
  { key: 'business_name', label: 'Business', locked: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'cf:address', label: 'address', group: '(custom)' },
];

function open(props: Partial<React.ComponentProps<typeof ColumnSettings>> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onMove: vi.fn(),
    onReset: vi.fn(),
    onPresetSelect: vi.fn(),
    onDensityChange: vi.fn(),
  };
  render(
    <ColumnSettings
      options={OPTIONS}
      visible={['business_name', 'email']}
      density="comfortable"
      {...handlers}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /columns|fields/i }));
  return handlers;
}

describe('ColumnSettings', () => {
  it('splits options into visible and hidden', () => {
    open();
    expect(screen.getByLabelText('Hide Email')).toBeChecked();
    expect(screen.getByLabelText('Show Phone')).not.toBeChecked();
    expect(screen.getByLabelText('Show address')).toBeInTheDocument();
  });

  it('does not allow a locked option to be hidden', () => {
    open();
    expect(screen.getByLabelText('Hide Business')).toBeDisabled();
  });

  it('toggles and reorders', () => {
    const handlers = open();
    fireEvent.click(screen.getByLabelText('Show Phone'));
    expect(handlers.onToggle).toHaveBeenCalledWith('phone');

    fireEvent.click(screen.getByLabelText('Move Email up'));
    expect(handlers.onMove).toHaveBeenCalledWith('email', -1);
  });

  it('applies a preset', () => {
    const handlers = open({
      presets: [{ label: 'Essentials only', keys: ['business_name'] }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Essentials only' }));
    expect(handlers.onPresetSelect).toHaveBeenCalledWith(['business_name']);
  });

  it('hides the reorder and density controls when not configured', () => {
    render(
      <ColumnSettings
        label="Fields"
        options={OPTIONS}
        visible={['business_name', 'email']}
        onToggle={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /fields/i }));

    expect(screen.queryByLabelText('Move Email up')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'compact' })).not.toBeInTheDocument();
  });
});
