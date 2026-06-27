/**
 * Sentry smoke test.
 *
 * Proves Sentry.captureException (re-exported via shared/utils/sentry)
 * reaches the underlying transport with the expected payload shape,
 * including the `extra` field that workers/middleware use to attach
 * contextual metadata (jobId, leadId, etc.).
 */

jest.mock('@sentry/node', () => {
  const captureException = jest.fn();
  const captureMessage = jest.fn();
  const init = jest.fn();
  return {
    __esModule: true,
    captureException,
    captureMessage,
    init,
    // Re-export other named exports that may be referenced
    withScope: jest.fn((cb: (scope: any) => void) => cb({ setExtra: jest.fn(), setTag: jest.fn(), setLevel: jest.fn() })),
    getCurrentHub: jest.fn(() => ({ getClient: jest.fn(() => ({ captureException: jest.fn() })) })),
  };
});

import * as SentryNode from '@sentry/node';
import { Sentry } from '../shared/utils/sentry';

const mockedCaptureException = SentryNode.captureException as unknown as jest.Mock;

describe('sentry smoke (captureException reaches transport)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards captureException(error) to the @sentry/node transport', () => {
    const err = new Error('test');
    Sentry.captureException(err);

    expect(mockedCaptureException).toHaveBeenCalledTimes(1);
    expect(mockedCaptureException).toHaveBeenCalledWith(err);
  });

  it('forwards captureException(error, hint) with hint.extra payload', () => {
    const err = new Error('boom');
    const hint = { extra: { jobId: 'job-1', queue: 'ai:inbox' } };
    Sentry.captureException(err, hint);

    expect(mockedCaptureException).toHaveBeenCalledTimes(1);
    expect(mockedCaptureException).toHaveBeenCalledWith(err, expect.objectContaining({
      extra: expect.objectContaining({ jobId: 'job-1', queue: 'ai:inbox' }),
    }));
  });

  it('preserves leadId and campaignId in extra when provided', () => {
    const err = new Error('ai-reply failed');
    Sentry.captureException(err, {
      extra: { leadId: 'lead-42', campaignId: 'camp-7' },
    });

    expect(mockedCaptureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        extra: expect.objectContaining({ leadId: 'lead-42', campaignId: 'camp-7' }),
      }),
    );
  });

  it('handles non-Error throwables', () => {
    const stringErr = 'a string error';
    Sentry.captureException(stringErr as unknown as Error);
    expect(mockedCaptureException).toHaveBeenCalledWith(stringErr);
  });

  it('passes through undefined hint without breaking', () => {
    const err = new Error('plain');
    Sentry.captureException(err, undefined);
    expect(mockedCaptureException).toHaveBeenCalledTimes(1);
  });
});
