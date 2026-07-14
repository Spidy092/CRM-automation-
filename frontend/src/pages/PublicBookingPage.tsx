import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  usePublicBookingPage,
  usePublicSlots,
  useCreatePublicBooking,
} from '@/api/scheduling';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Clock, MapPin, CheckCircle } from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const { showToast } = useToast();

  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data: pageData, isLoading: loadingPage } = usePublicBookingPage(slug ?? '');
  const { data: slotsData, isLoading: loadingSlots } = usePublicSlots(slug ?? '', selectedDate);
  const createBooking = useCreatePublicBooking();

  const page = pageData?.data;
  const slots = slotsData?.data?.slots ?? [];

  const handleSubmit = async () => {
    if (!selectedSlot || !name.trim() || !email.trim()) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    try {
      await createBooking.mutateAsync({
        slug: slug ?? '',
        data: {
          bookerName: name.trim(),
          bookerEmail: email.trim(),
          bookerPhone: phone.trim() || undefined,
          startsAt: selectedSlot.start,
          notes: notes.trim() || undefined,
        },
      });
      setSubmitted(true);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to book meeting'), 'error');
    }
  };

  if (loadingPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Booking page not found</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h2 className="mt-4 text-xl font-bold text-slate-900">Meeting Booked!</h2>
            <p className="mt-2 text-sm text-slate-600">
              You&apos;re scheduled for{' '}
              <strong>
                {selectedSlot && new Date(selectedSlot.start).toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </strong>{' '}
              at{' '}
              <strong>
                {selectedSlot && new Date(selectedSlot.start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </strong>
            </p>
            {page.meeting_url && (
              <a
                href={page.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm text-indigo-600 underline"
              >
                Open Google Calendar Invite
              </a>
            )}
            <p className="mt-4 text-xs text-slate-400">
              A confirmation will be sent to {email}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Generate next 14 days
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < (page.max_advance_days || 14); i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">{page.title}</h1>
          {page.description && (
            <p className="mt-2 text-slate-600">{page.description}</p>
          )}
          <div className="mt-3 flex items-center gap-4 text-sm text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" /> 30 min
            </span>
            {page.location_type && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {page.location_type.replace('_', ' ')}
              </span>
            )}
          </div>
        </div>

        {/* Date picker */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <CardTitle className="mb-3 text-sm">Select a Date</CardTitle>
            <div className="flex flex-wrap gap-2">
              {dates.map((date) => {
                const d = new Date(date + 'T12:00:00Z');
                const dayName = DAY_NAMES[d.getUTCDay()];
                const dayNum = d.getUTCDate();
                const month = d.toLocaleString('default', { month: 'short' });
                const isSelected = selectedDate === date;

                return (
                  <button
                    key={date}
                    onClick={() => { setSelectedDate(date); setSelectedSlot(null); }}
                    className={`rounded-lg border px-3 py-2 text-center transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs text-slate-500">{dayName.slice(0, 3)}</div>
                    <div className="text-lg font-bold">{dayNum}</div>
                    <div className="text-xs text-slate-500">{month}</div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Time slots */}
        {selectedDate && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <CardTitle className="mb-3 text-sm">Available Times</CardTitle>
              {loadingSlots ? (
                <div className="flex justify-center py-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                </div>
              ) : slots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots
                    .filter((s) => s.available)
                    .map((slot) => {
                      const isSelected =
                        selectedSlot?.start === slot.start;
                      const time = new Date(slot.start).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      return (
                        <button
                          key={slot.start}
                          onClick={() => setSelectedSlot(slot)}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-500 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                          }`}
                        >
                          {time}
                        </button>
                      );
                    })}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No available times on this date.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Booking form */}
        {selectedSlot && (
          <Card>
            <CardContent className="p-5 space-y-4">
              <CardTitle className="text-base">Your Details</CardTitle>

              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <textarea
                  id="notes"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything you'd like us to know..."
                />
              </div>

              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                <strong>Selected:</strong>{' '}
                {new Date(selectedSlot.start).toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                at{' '}
                {new Date(selectedSlot.start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>

              <Button className="w-full" onClick={handleSubmit} disabled={createBooking.isPending}>
                {createBooking.isPending ? 'Booking...' : 'Confirm Booking'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
