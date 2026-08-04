jest.mock('./scheduling.repository', () => ({
  findAvailabilityByUser: jest.fn(),
  upsertAvailability: jest.fn(),
  findAvailabilityByUserAndDay: jest.fn(),
  findBookingsByUserAndDateRange: jest.fn(),
  findBookingUrlsByUser: jest.fn(),
  findBookingUrlBySlug: jest.fn(),
  findBookingUrlById: jest.fn(),
  insertBookingUrl: jest.fn(),
  updateBookingUrl: jest.fn(),
  findBookingsByUser: jest.fn(),
  findConflictingBookings: jest.fn(),
  insertBooking: jest.fn(),
  findBookingById: jest.fn(),
  updateBookingStatus: jest.fn(),
  getAllBookingUrlUsers: jest.fn(),
  getLastBookedUser: jest.fn(),
  findDateOverridesByUser: jest.fn(),
  findDateOverrideByUserAndDate: jest.fn(),
  upsertDateOverride: jest.fn(),
  deleteDateOverride: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../integrations/google-calendar/google-calendar.connector', () => ({
  createEvent: jest.fn(),
  deleteEvent: jest.fn(),
}));

import {
  getUserAvailability,
  setAvailability,
  getAvailableSlots,
  listBookingUrls,
  getBookingUrlBySlug,
  getBookingUrlById,
  createBookingUrl,
  updateBookingUrlById,
  listBookings,
  createBooking,
  createInternalBooking,
  cancelBooking,
  getRoundRobinUser,
} from './scheduling.service';
import * as repo from './scheduling.repository';
import { createEvent, deleteEvent } from '../integrations/google-calendar/google-calendar.connector';

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedCreateEvent = createEvent as jest.MockedFunction<typeof createEvent>;
const mockedDeleteEvent = deleteEvent as jest.MockedFunction<typeof deleteEvent>;

describe('scheduling.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('availability', () => {
    it('gets user availability', async () => {
      mockedRepo.findAvailabilityByUser.mockResolvedValue([]);
      await expect(getUserAvailability('u1')).resolves.toEqual([]);
    });

    it('sets availability and returns updated rows', async () => {
      mockedRepo.upsertAvailability.mockResolvedValue(undefined);
      mockedRepo.findAvailabilityByUser.mockResolvedValue([
        { id: 'a1', user_id: 'u1', day_of_week: 1, start_time: '09:00', end_time: '17:00', slot_duration_min: 30, is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
      ]);
      const res = await setAvailability('u1', [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', slotDurationMin: 30, isActive: true }], 'admin-1');
      expect(res).toHaveLength(1);
    });

    it('throws AppError 400 when start time is after or equal to end time', async () => {
      await expect(
        setAvailability('u1', [{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00', slotDurationMin: 30, isActive: true }], 'admin-1'),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getAvailableSlots', () => {
    it('returns empty slots when no availability', async () => {
      mockedRepo.findDateOverrideByUserAndDate.mockResolvedValue(null);
      mockedRepo.findAvailabilityByUserAndDay.mockResolvedValue([]);
      const res = await getAvailableSlots('u1', '2026-07-10');
      expect(res.slots).toHaveLength(0);
    });

    it('returns empty slots when date is blocked by date override', async () => {
      mockedRepo.findDateOverrideByUserAndDate.mockResolvedValue({
        id: 'ov-1',
        user_id: 'u1',
        override_date: '2026-07-10',
        is_blocked: true,
        start_time: null,
        end_time: null,
        reason: 'Vacation',
        created_at: '',
        updated_at: '',
      });
      const res = await getAvailableSlots('u1', '2026-07-10');
      expect(res.slots).toHaveLength(0);
    });

    it('generates slots and marks conflicts unavailable', async () => {
      mockedRepo.findDateOverrideByUserAndDate.mockResolvedValue(null);
      mockedRepo.findBookingUrlsByUser.mockResolvedValue([]);
      mockedRepo.findAvailabilityByUserAndDay.mockResolvedValue([
        { id: 'a1', user_id: 'u1', day_of_week: 5, start_time: '09:00', end_time: '09:30', slot_duration_min: 30, is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
      ]);
      mockedRepo.findBookingsByUserAndDateRange.mockResolvedValue([
        { id: 'b1', starts_at: '2026-07-10T09:00:00.000Z', ends_at: '2026-07-10T09:30:00.000Z' },
      ] as any);
      const res = await getAvailableSlots('u1', '2026-07-10');
      expect(res.slots).toHaveLength(1);
      expect(res.slots[0].available).toBe(false);
    });
  });

  describe('booking urls', () => {
    it('lists urls', async () => {
      mockedRepo.findBookingUrlsByUser.mockResolvedValue([]);
      await expect(listBookingUrls('u1')).resolves.toEqual([]);
    });

    it('throws 404 for missing slug', async () => {
      mockedRepo.findBookingUrlBySlug.mockResolvedValue(null);
      await expect(getBookingUrlBySlug('missing')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('gets booking url by id when owner matches', async () => {
      mockedRepo.findBookingUrlById.mockResolvedValue({ id: 'url-1', user_id: 'u1' } as any);
      const res = await getBookingUrlById('url-1', 'u1');
      expect(res.id).toBe('url-1');
    });

    it('throws 404 when booking url id not found', async () => {
      mockedRepo.findBookingUrlById.mockResolvedValue(null);
      await expect(getBookingUrlById('missing', 'u1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 when booking url belongs to another user', async () => {
      mockedRepo.findBookingUrlById.mockResolvedValue({ id: 'url-1', user_id: 'other' } as any);
      await expect(getBookingUrlById('url-1', 'u1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('creates url with unique slug', async () => {
      mockedRepo.findBookingUrlBySlug.mockResolvedValueOnce(null as any).mockResolvedValue({ id: 'url-1' } as any);
      mockedRepo.insertBookingUrl.mockResolvedValue({ id: 'url-1', slug: 'test', title: 'Test' } as any);
      const res = await createBookingUrl('u1', { title: 'Test', description: '', locationType: 'google_meet', bufferBeforeMin: 0, bufferAfterMin: 0, maxAdvanceDays: 30 });
      expect(res.id).toBe('url-1');
    });

    it('updates url by id', async () => {
      mockedRepo.updateBookingUrl.mockResolvedValue({ id: 'url-1', title: 'Updated' } as any);
      const res = await updateBookingUrlById('url-1', { title: 'Updated' }, 'u1');
      expect(res.title).toBe('Updated');
    });
  });

  describe('bookings', () => {
    it('lists bookings', async () => {
      mockedRepo.findBookingsByUser.mockResolvedValue([]);
      await expect(listBookings('u1')).resolves.toEqual([]);
    });

    it('throws 404 when booking url missing', async () => {
      mockedRepo.findBookingUrlBySlug.mockResolvedValue(null);
      await expect(createBooking('missing', { startsAt: new Date(Date.now() + 86400000).toISOString(), bookerName: 'A', bookerEmail: 'a@x.com' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('creates booking with google calendar event', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      mockedRepo.findBookingUrlBySlug.mockResolvedValue({ id: 'url-1', user_id: 'u1', max_advance_days: 30, title: 'Test', is_active: true } as any);
      mockedRepo.findConflictingBookings.mockResolvedValue([]);
      mockedCreateEvent.mockResolvedValue({ ok: true, eventId: 'evt-1', htmlLink: 'http://meet' } as any);
      mockedRepo.insertBooking.mockResolvedValue({ id: 'book-1', starts_at: future } as any);
      const res = await createBooking('slug', { startsAt: future, bookerName: 'A', bookerEmail: 'a@x.com' });
      expect(res.id).toBe('book-1');
      expect(mockedCreateEvent).toHaveBeenCalled();
    });

    it('throws 409 when slot conflicts', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      mockedRepo.findBookingUrlBySlug.mockResolvedValue({ id: 'url-1', user_id: 'u1', max_advance_days: 30, is_active: true } as any);
      mockedRepo.findConflictingBookings.mockResolvedValue([{ id: 'conflict' }] as any);
      await expect(createBooking('slug', { startsAt: future, bookerName: 'A', bookerEmail: 'a@x.com' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('cancels booking and updates status', async () => {
      mockedRepo.findBookingById.mockResolvedValue({ id: 'book-1', user_id: 'u1', google_event_id: 'evt-1' } as any);
      mockedRepo.updateBookingStatus.mockResolvedValue({ id: 'book-1', status: 'cancelled' } as any);
      const res = await cancelBooking('book-1', 'u1');
      expect(res.status).toBe('cancelled');
    });

    it('throws 403 when cancelling another user\'s booking', async () => {
      mockedRepo.findBookingById.mockResolvedValue({ id: 'book-1', user_id: 'other-user', google_event_id: null } as any);
      await expect(cancelBooking('book-1', 'u1')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('creates internal booking on behalf of lead with calendar invite', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      mockedRepo.findConflictingBookings.mockResolvedValue([]);
      mockedRepo.findDateOverrideByUserAndDate.mockResolvedValue(null);
      mockedRepo.findBookingUrlsByUser.mockResolvedValue([{ id: 'url-1', is_active: true }] as any);
      mockedCreateEvent.mockResolvedValue({ ok: true, eventId: 'evt-internal', htmlLink: 'http://meet' } as any);
      mockedRepo.insertBooking.mockResolvedValue({ id: 'book-internal', starts_at: future } as any);

      const res = await createInternalBooking('u1', {
        bookerName: 'Lead Client',
        bookerEmail: 'client@company.com',
        startsAt: future,
        notes: 'Sales Call',
      });
      expect(res.id).toBe('book-internal');
      expect(mockedCreateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          attendees: ['client@company.com'],
        }),
      );
    });
  });

  describe('round robin', () => {
    it('returns null when no users', async () => {
      mockedRepo.getAllBookingUrlUsers.mockResolvedValue([]);
      const res = await getRoundRobinUser();
      expect(res).toBeNull();
    });

    it('returns first user when no last booked', async () => {
      mockedRepo.getAllBookingUrlUsers.mockResolvedValue([{ user_id: 'u1' }] as any);
      mockedRepo.getLastBookedUser.mockResolvedValue(null);
      const res = await getRoundRobinUser();
      expect(res).toBe('u1');
      expect(mockedRepo.getLastBookedUser).toHaveBeenCalledWith(['u1']);
    });

    it('returns next user in round robin', async () => {
      mockedRepo.getAllBookingUrlUsers.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }] as any);
      mockedRepo.getLastBookedUser.mockResolvedValue('u1');
      const res = await getRoundRobinUser();
      expect(res).toBe('u2');
      expect(mockedRepo.getLastBookedUser).toHaveBeenCalledWith(['u1', 'u2']);
    });
  });
});
