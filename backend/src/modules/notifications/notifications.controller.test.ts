import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response } from 'express';
import { sseHandler } from './notifications.controller';
import * as emitter from './notifications.emitter';

jest.mock('./notifications.emitter', () => ({
  subscribeUser: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedEmitter = emitter as jest.Mocked<typeof emitter>;

interface MockReq {
  on: any;
  user?: { id: string; role: 'admin' | 'sales' | 'manager' | 'viewer'; name: string; email: string };
}

function buildReq(opts: { user?: { id: string; role: 'admin' | 'sales' | 'manager' | 'viewer'; name: string; email: string } | null } = {}): MockReq {
  const user = opts.user === undefined ? { id: 'u-1', role: 'sales' as const, name: 'Test', email: 'test@test.com' } : opts.user;
  return {
    user: user === null ? undefined : user,
    on: jest.fn(),
  };
}

interface MockRes extends Partial<Response> {
  _writes: string[];
  _headers: Record<string, string>;
  _clearedIntervals: number[];
}

function buildRes(): MockRes {
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  const clearedIntervals: number[] = [];
  let intervalCounter = 0;

  const res = {
    _writes: writes,
    _headers: headers,
    _clearedIntervals: clearedIntervals,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockRes;

  (res.setHeader as jest.Mock<any>).mockImplementation((name: string, value: string) => {
    headers[name] = value;
    return res;
  });
  (res.write as jest.Mock<any>).mockImplementation((chunk: string) => {
    writes.push(chunk);
    return true;
  });
  (res.status as jest.Mock<any>).mockReturnValue(res);
  (res.json as jest.Mock<any>).mockReturnValue(res);

  // Patch the global setInterval/clearInterval behavior we need to verify.
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  global.setInterval = ((handler: () => void, ms: number) => {
    intervalCounter += 1;
    const id = intervalCounter;
    void ms;
    void handler;
    return id as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  global.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    clearedIntervals.push(id as unknown as number);
  }) as typeof clearInterval;

  // Restore after the test by attaching cleanup to the res object.
  (res as unknown as { _restore: () => void })._restore = (): void => {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
  };

  return res;
}

describe('sseHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 401 when req.user is missing', () => {
    const req = buildReq({ user: null });
    const res = buildRes();

    sseHandler(req as unknown as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(mockedEmitter.subscribeUser).not.toHaveBeenCalled();
  });

  it('sets SSE headers and flushes the head', () => {
    const unsubscribe = jest.fn();
    mockedEmitter.subscribeUser.mockReturnValue(unsubscribe);
    const req = buildReq();
    const res = buildRes();

    sseHandler(req as unknown as Request, res as unknown as Response);
    (res as unknown as { _restore: () => void })._restore();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('writes a connected event on connect', () => {
    mockedEmitter.subscribeUser.mockReturnValue(jest.fn());
    const req = buildReq();
    const res = buildRes();

    sseHandler(req as unknown as Request, res as unknown as Response);
    (res as unknown as { _restore: () => void })._restore();

    expect(res.write).toHaveBeenCalledWith(':connected\n\n');
  });

  it('registers a close handler that clears the heartbeat and unsubscribes', () => {
    const unsubscribe = jest.fn();
    mockedEmitter.subscribeUser.mockReturnValue(unsubscribe);
    const req = buildReq();
    const res = buildRes();

    sseHandler(req as unknown as Request, res as unknown as Response);
    (res as unknown as { _restore: () => void })._restore();

    expect(req.on).toHaveBeenCalledWith('close', expect.any(Function));
    const closeHandler = req.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1] as () => void;
    expect(closeHandler).toBeDefined();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    
    closeHandler();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalled();
    
    clearIntervalSpy.mockRestore();
  });

  it('writes incoming notifications as SSE data frames', () => {
    let registeredHandler: ((n: unknown) => void) | undefined;
    mockedEmitter.subscribeUser.mockImplementation((_userId, handler) => {
      registeredHandler = handler as (n: unknown) => void;
      return jest.fn();
    });

    const req = buildReq();
    const res = buildRes();

    sseHandler(req as unknown as Request, res as unknown as Response);
    (res as unknown as { _restore: () => void })._restore();

    expect(typeof registeredHandler).toBe('function');
    registeredHandler!({
      id: 'n-9',
      type: 'lead_assigned',
      title: 'New lead',
      message: 'You got a new lead',
      timestamp: '2025-06-01T12:00:00Z',
    });

    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('"id":"n-9"'),
    );
  });
});
