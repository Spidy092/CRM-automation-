import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SmsEditor, WhatsappEditor } from '../ChannelEditors';

describe('channel-specific template editors', () => {
  it('shows SMS encoding and segment estimates and exposes their explanation', () => {
    const onChange = vi.fn();
    render(<SmsEditor body={'a'.repeat(161)} onChange={onChange} />);

    expect(screen.getByRole('status')).toHaveTextContent('161 chars · GSM-7 · 2 segments');
    const details = screen.getByText('How are segments counted?');
    expect(details.tagName).toBe('SUMMARY');
    expect(details.parentElement).toHaveTextContent('153 per segment when concatenated');
  });

  it('keeps WhatsApp validation and media guidance in its channel editor', () => {
    render(<WhatsappEditor body="Hello" onChange={vi.fn()} attachmentCount={0} />);

    expect(screen.getByLabelText('Message body *')).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp Cloud API as a text message/)).toBeInTheDocument();
    expect(screen.queryByText(/GSM-7/)).not.toBeInTheDocument();
  });
});
