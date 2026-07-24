import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiResponse } from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export interface Availability {
  id: string;
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_min: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookingUrl {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string | null;
  location_type: string;
  location_details: string | null;
  buffer_before_min: number;
  buffer_after_min: number;
  max_advance_days: number;
  is_active: boolean;
  meeting_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  booking_url_id: string;
  user_id: string;
  lead_id: string | null;
  booker_name: string;
  booker_email: string;
  booker_phone: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  meeting_url: string | null;
  notes: string | null;
  google_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface DateAvailability {
  date: string;
  slots: TimeSlot[];
}

export interface CreateBookingUrlInput {
  title: string;
  description?: string;
  locationType?: string;
  locationDetails?: string;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  maxAdvanceDays?: number;
}

export type UpdateBookingUrlInput = Partial<CreateBookingUrlInput> & { isActive?: boolean };

export interface CreateBookingInput {
  bookerName: string;
  bookerEmail: string;
  bookerPhone?: string;
  startsAt: string;
  notes?: string;
  leadId?: string;
}

export interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMin: number;
  isActive: boolean;
}

// ── Hooks ─────────────────────────────────────────────────────────────────

const SCHED_KEY = ['scheduling'];

// Availability

export function useAvailability() {
  return useQuery({
    queryKey: [...SCHED_KEY, 'availability'],
    queryFn: () => apiClient.get<ApiResponse<Availability[]>>('/scheduling/availability').then((r) => r.data),
  });
}

export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slots: AvailabilitySlot[]) =>
      apiClient.put<ApiResponse<Availability[]>>('/scheduling/availability', { slots }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'availability'] }); },
  });
}

export function useAvailableSlots(userId: string, date: string) {
  return useQuery({
    queryKey: [...SCHED_KEY, 'slots', userId, date],
    queryFn: () => apiClient.get<ApiResponse<DateAvailability>>('/scheduling/availability/slots', {
      params: { userId, date },
    }).then((r) => r.data),
    enabled: !!userId && !!date,
  });
}

// Booking URLs

export function useBookingUrls() {
  return useQuery({
    queryKey: [...SCHED_KEY, 'urls'],
    queryFn: () => apiClient.get<ApiResponse<BookingUrl[]>>('/scheduling/urls').then((r) => r.data),
  });
}

export function useBookingUrl(id: string) {
  return useQuery({
    queryKey: [...SCHED_KEY, 'urls', id],
    queryFn: () => apiClient.get<ApiResponse<BookingUrl>>(`/scheduling/urls/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateBookingUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBookingUrlInput) =>
      apiClient.post<ApiResponse<BookingUrl>>('/scheduling/urls', data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'urls'] }); },
  });
}

export function useUpdateBookingUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBookingUrlInput }) =>
      apiClient.put<ApiResponse<BookingUrl>>(`/scheduling/urls/${id}`, data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'urls'] }); },
  });
}

// Public booking

export function usePublicBookingPage(slug: string) {
  return useQuery({
    queryKey: [...SCHED_KEY, 'public', slug],
    queryFn: () => apiClient.get<ApiResponse<BookingUrl>>(`/scheduling/book/${slug}`).then((r) => r.data),
    enabled: !!slug,
  });
}

export function usePublicSlots(slug: string, date: string) {
  return useQuery({
    queryKey: [...SCHED_KEY, 'public', 'slots', slug, date],
    queryFn: () => apiClient.get<ApiResponse<DateAvailability>>(`/scheduling/book/${slug}/slots`, {
      params: { date },
    }).then((r) => r.data),
    enabled: !!slug && !!date,
  });
}

export function useCreatePublicBooking() {
  return useMutation({
    mutationFn: ({ slug, data }: { slug: string; data: CreateBookingInput }) =>
      apiClient.post<ApiResponse<Booking>>(`/scheduling/book/${slug}`, data).then((r) => r.data),
  });
}

// Bookings

export function useBookings() {
  return useQuery({
    queryKey: [...SCHED_KEY, 'bookings'],
    queryFn: () => apiClient.get<ApiResponse<Booking[]>>('/scheduling/bookings').then((r) => r.data),
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      apiClient.post<ApiResponse<Booking>>(`/scheduling/bookings/${bookingId}/cancel`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'bookings'] }); },
  });
}

export interface CreateInternalBookingInput {
  leadId?: string;
  bookingUrlId?: string;
  bookerName: string;
  bookerEmail: string;
  bookerPhone?: string;
  startsAt: string;
  notes?: string;
  forceOverride?: boolean;
}

export function useCreateInternalBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInternalBookingInput) =>
      apiClient.post<ApiResponse<Booking>>('/scheduling/bookings', data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'bookings'] }); },
  });
}

// Round Robin

export function useRoundRobinUser() {
  return useQuery({
    queryKey: [...SCHED_KEY, 'round-robin'],
    queryFn: () => apiClient.get<ApiResponse<{ userId: string | null }>>('/scheduling/round-robin').then((r) => r.data),
  });
}

// Date Overrides

export interface UserDateOverride {
  id: string;
  user_id: string;
  override_date: string;
  is_blocked: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export function useDateOverrides() {
  return useQuery({
    queryKey: [...SCHED_KEY, 'overrides'],
    queryFn: () => apiClient.get<ApiResponse<UserDateOverride[]>>('/scheduling/overrides').then((r) => r.data),
  });
}

export function useSetDateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { overrideDate: string; isBlocked: boolean; startTime?: string; endTime?: string; reason?: string }) =>
      apiClient.post<ApiResponse<UserDateOverride>>('/scheduling/overrides', data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'overrides'] }); },
  });
}

export function useDeleteDateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrideId: string) =>
      apiClient.delete<ApiResponse<{ success: boolean }>>(`/scheduling/overrides/${overrideId}`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...SCHED_KEY, 'overrides'] }); },
  });
}
