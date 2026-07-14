export interface Availability {
  id: string;
  user_id: string;
  day_of_week: number; // 0=Sunday, 6=Saturday
  start_time: string; // "09:00"
  end_time: string; // "17:00"
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
  location_type: string; // google_meet, phone, custom
  location_details: string | null;
  buffer_before_min: number;
  buffer_after_min: number;
  max_advance_days: number;
  is_active: boolean;
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
  status: string; // confirmed, cancelled, completed, no_show
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

export interface UpdateBookingUrlInput {
  title?: string;
  description?: string;
  locationType?: string;
  locationDetails?: string;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  maxAdvanceDays?: number;
  isActive?: boolean;
}

export interface CreateBookingInput {
  bookerName: string;
  bookerEmail: string;
  bookerPhone?: string;
  startsAt: string;
  notes?: string;
  leadId?: string;
}

export interface RoundRobinConfig {
  enabled: boolean;
  method: 'round_robin' | 'least_recent' | 'random';
}
