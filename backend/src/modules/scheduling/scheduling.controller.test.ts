import type { Request, Response, NextFunction } from 'express';
import * as schedulingService from './scheduling.service';
import {
  getAvailabilityHandler,
  setAvailabilityHandler,
  getAvailableSlotsHandler,
  listBookingUrlsHandler,
  getBookingUrlHandler,
  createBookingUrlHandler,
  updateBookingUrlHandler,
  getPublicBookingPageHandler,
  getPublicAvailableSlotsHandler,
  createPublicBookingHandler,
  listBookingsHandler,
  createInternalBookingHandler,
  cancelBookingHandler,
  getRoundRobinUserHandler,
  listDateOverridesHandler,
  setDateOverrideHandler,
  deleteDateOverrideHandler,
} from './scheduling.controller';

jest.mock('./scheduling.service');

const USER_ID = '11111111-1111-1111-1111-111111111111';
const svc = schedulingService as jest.Mocked<typeof schedulingService>;

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: USER_ID, role: 'sales', email: 'a@b.com', name: 'A' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockReturnThis();
  return res as Response;
}

const next = jest.fn() as NextFunction;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAvailabilityHandler', () => {
  it('returns the caller availability', async () => {
    svc.getUserAvailability.mockResolvedValue([{ id: 'a1' }] as any);
    const req = buildReq();
    const res = buildRes();
    await getAvailabilityHandler(req, res, next);
    expect(svc.getUserAvailability).toHaveBeenCalledWith(USER_ID);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('forwards service errors to next', async () => {
    const err = new Error('boom');
    svc.getUserAvailability.mockRejectedValue(err);
    await getAvailabilityHandler(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('setAvailabilityHandler', () => {
  it('validates and forwards slots to the service', async () => {
    svc.setAvailability.mockResolvedValue([] as any);
    const body = {
      slots: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
    };
    const req = buildReq({ body });
    await setAvailabilityHandler(req, buildRes(), next);
    expect(svc.setAvailability).toHaveBeenCalledWith(
      USER_ID,
      [expect.objectContaining({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })],
      USER_ID,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with a ZodError for invalid slots', async () => {
    const req = buildReq({ body: { slots: [{ dayOfWeek: 9 }] } });
    await setAvailabilityHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.setAvailability).not.toHaveBeenCalled();
  });
});

describe('getAvailableSlotsHandler', () => {
  it('defaults userId to the caller when not provided in the query', async () => {
    svc.getAvailableSlots.mockResolvedValue([] as any);
    const req = buildReq({ query: { date: '2026-08-01' } });
    await getAvailableSlotsHandler(req, buildRes(), next);
    expect(svc.getAvailableSlots).toHaveBeenCalledWith(USER_ID, '2026-08-01');
  });

  it('uses the userId from the query when provided', async () => {
    svc.getAvailableSlots.mockResolvedValue([] as any);
    const otherUser = '22222222-2222-2222-2222-222222222222';
    const req = buildReq({ query: { date: '2026-08-01', userId: otherUser } });
    await getAvailableSlotsHandler(req, buildRes(), next);
    expect(svc.getAvailableSlots).toHaveBeenCalledWith(otherUser, '2026-08-01');
  });
});

describe('listBookingUrlsHandler', () => {
  it('lists booking urls for the caller', async () => {
    svc.listBookingUrls.mockResolvedValue([{ id: 'b1' }] as any);
    await listBookingUrlsHandler(buildReq(), buildRes(), next);
    expect(svc.listBookingUrls).toHaveBeenCalledWith(USER_ID);
  });
});

describe('getBookingUrlHandler', () => {
  it('calls getBookingUrlById on the service', async () => {
    svc.getBookingUrlById.mockResolvedValue({ id: 'b1', user_id: USER_ID } as any);
    const res = buildRes();
    await getBookingUrlHandler(buildReq({ params: { id: 'b1' } }), res, next);
    expect(svc.getBookingUrlById).toHaveBeenCalledWith('b1', USER_ID);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('forwards service errors to next', async () => {
    const err = new Error('not found');
    svc.getBookingUrlById.mockRejectedValue(err);
    const res = buildRes();
    await getBookingUrlHandler(buildReq({ params: { id: 'missing' } }), res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('createBookingUrlHandler', () => {
  it('creates a booking url and returns 201', async () => {
    svc.createBookingUrl.mockResolvedValue({ id: 'b1' } as any);
    const res = buildRes();
    const req = buildReq({ body: { title: 'Intro Call' } });
    await createBookingUrlHandler(req, res, next);
    expect(svc.createBookingUrl).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ title: 'Intro Call' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateBookingUrlHandler', () => {
  it('updates the booking url by id', async () => {
    svc.updateBookingUrlById.mockResolvedValue({ id: 'b1', title: 'Updated' } as any);
    const req = buildReq({ params: { id: 'b1' }, body: { title: 'Updated' } });
    await updateBookingUrlHandler(req, buildRes(), next);
    expect(svc.updateBookingUrlById).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ title: 'Updated' }),
      USER_ID,
    );
  });
});

describe('getPublicBookingPageHandler', () => {
  it('strips user_id and marks the page public', async () => {
    svc.getBookingUrlBySlug.mockResolvedValue({ id: 'b1', user_id: USER_ID, title: 'Intro' } as any);
    const res = buildRes();
    await getPublicBookingPageHandler(buildReq({ params: { slug: 'intro-call' } }), res, next);
    expect(svc.getBookingUrlBySlug).toHaveBeenCalledWith('intro-call');
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.isPublic).toBe(true);
    expect(payload.data.user_id).toBeUndefined();
  });
});

describe('getPublicAvailableSlotsHandler', () => {
  it('resolves the booking url then fetches slots for its owner', async () => {
    svc.getBookingUrlBySlug.mockResolvedValue({ id: 'b1', user_id: USER_ID } as any);
    svc.getAvailableSlots.mockResolvedValue([] as any);
    const req = buildReq({ params: { slug: 'intro-call' }, query: { date: '2026-08-01' } });
    await getPublicAvailableSlotsHandler(req, buildRes(), next);
    expect(svc.getAvailableSlots).toHaveBeenCalledWith(USER_ID, '2026-08-01', 'intro-call');
  });
});

describe('createPublicBookingHandler', () => {
  it('validates the booking body and creates the booking', async () => {
    svc.createBooking.mockResolvedValue({ id: 'bk1' } as any);
    const res = buildRes();
    const req = buildReq({
      params: { slug: 'intro-call' },
      body: {
        bookerName: 'Jane',
        bookerEmail: 'jane@example.com',
        startsAt: '2026-08-01T10:00:00.000Z',
      },
    });
    await createPublicBookingHandler(req, res, next);
    expect(svc.createBooking).toHaveBeenCalledWith(
      'intro-call',
      expect.objectContaining({ bookerName: 'Jane', bookerEmail: 'jane@example.com' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('calls next with a validation error for a malformed booking body', async () => {
    const req = buildReq({ params: { slug: 'intro-call' }, body: { bookerEmail: 'not-an-email' } });
    await createPublicBookingHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.createBooking).not.toHaveBeenCalled();
  });
});

describe('listBookingsHandler', () => {
  it('lists bookings for the caller', async () => {
    svc.listBookings.mockResolvedValue([] as any);
    await listBookingsHandler(buildReq(), buildRes(), next);
    expect(svc.listBookings).toHaveBeenCalledWith(USER_ID);
  });
});

describe('createInternalBookingHandler', () => {
  it('creates an internal booking on behalf of the caller', async () => {
    svc.createInternalBooking.mockResolvedValue({ id: 'bk1' } as any);
    const res = buildRes();
    const req = buildReq({
      body: {
        bookerName: 'Jane',
        bookerEmail: 'jane@example.com',
        startsAt: '2026-08-01T10:00:00.000Z',
      },
    });
    await createInternalBookingHandler(req, res, next);
    expect(svc.createInternalBooking).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ bookerName: 'Jane' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('cancelBookingHandler', () => {
  const bookingId = '33333333-3333-3333-3333-333333333333';

  it('cancels the booking for the caller', async () => {
    svc.cancelBooking.mockResolvedValue({ id: bookingId, status: 'cancelled' } as any);
    const req = buildReq({ params: { bookingId } });
    await cancelBookingHandler(req, buildRes(), next);
    expect(svc.cancelBooking).toHaveBeenCalledWith(bookingId, USER_ID);
  });

  it('calls next with a validation error for a non-uuid bookingId', async () => {
    const req = buildReq({ params: { bookingId: 'not-a-uuid' } });
    await cancelBookingHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.cancelBooking).not.toHaveBeenCalled();
  });
});

describe('getRoundRobinUserHandler', () => {
  it('returns the next round robin user id', async () => {
    svc.getRoundRobinUser.mockResolvedValue(USER_ID);
    const res = buildRes();
    await getRoundRobinUserHandler(buildReq(), res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { userId: USER_ID } }),
    );
  });
});

describe('listDateOverridesHandler', () => {
  it('lists overrides for the caller', async () => {
    svc.listDateOverrides.mockResolvedValue([] as any);
    await listDateOverridesHandler(buildReq(), buildRes(), next);
    expect(svc.listDateOverrides).toHaveBeenCalledWith(USER_ID);
  });
});

describe('setDateOverrideHandler', () => {
  it('creates a date override and returns 201', async () => {
    svc.setDateOverride.mockResolvedValue({ id: 'ov1' } as any);
    const res = buildRes();
    const req = buildReq({ body: { overrideDate: '2026-12-25', isBlocked: true } });
    await setDateOverrideHandler(req, res, next);
    expect(svc.setDateOverride).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ overrideDate: '2026-12-25' }),
      USER_ID,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('deleteDateOverrideHandler', () => {
  const overrideId = '44444444-4444-4444-4444-444444444444';

  it('removes the date override for the caller', async () => {
    svc.removeDateOverride.mockResolvedValue(undefined as any);
    const req = buildReq({ params: { overrideId } });
    const res = buildRes();
    await deleteDateOverrideHandler(req, res, next);
    expect(svc.removeDateOverride).toHaveBeenCalledWith(overrideId, USER_ID);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { success: true } }));
  });
});
