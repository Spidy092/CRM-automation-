import { useState, useEffect } from 'react';
import {
  useAvailability,
  useSetAvailability,
  useBookingUrls,
  useCreateBookingUrl,
  useBookings,
  useCancelBooking,
  type AvailabilitySlot,
} from '@/api/scheduling';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  Calendar,
  Plus,
  Clock,
  Link2,
  ExternalLink,
  Copy,
  Check,
  X,
} from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SchedulingPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'availability' | 'urls' | 'bookings'>('availability');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Availability
  const { data: availability } = useAvailability();
  const setAvailability = useSetAvailability();

  // Booking URLs
  const { data: urls, isLoading: loadingUrls } = useBookingUrls();
  const createUrl = useCreateBookingUrl();

  // Bookings
  const { data: bookings, isLoading: loadingBookings } = useBookings();
  const cancelBooking = useCancelBooking();

  // New URL form
  const [showNewUrl, setShowNewUrl] = useState(false);
  const [newUrlTitle, setNewUrlTitle] = useState('');

  // Availability editing
  const [editingAvail, setEditingAvail] = useState<Record<number, { start: string; end: string; active: boolean }>>({});

  useEffect(() => {
    if (availability?.data) {
      const grouped: Record<number, { start: string; end: string; active: boolean }> = {};
      for (const a of availability.data) {
        grouped[a.day_of_week] = {
          start: a.start_time,
          end: a.end_time,
          active: a.is_active,
        };
      }
      setEditingAvail(grouped);
    }
  }, [availability]);

  const handleSaveAvailability = async () => {
    const slots: AvailabilitySlot[] = Object.entries(editingAvail)
      .filter(([, v]) => v.active)
      .map(([day, v]) => ({
        dayOfWeek: Number(day),
        startTime: v.start,
        endTime: v.end,
        slotDurationMin: 30,
        isActive: v.active,
      }));

    try {
      await setAvailability.mutateAsync(slots);
      showToast('Availability saved', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save availability'), 'error');
    }
  };

  const handleCreateUrl = async () => {
    if (!newUrlTitle.trim()) {
      showToast('Title is required', 'error');
      return;
    }
    try {
      await createUrl.mutateAsync({ title: newUrlTitle.trim() });
      showToast('Booking URL created', 'success');
      setShowNewUrl(false);
      setNewUrlTitle('');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to create URL'), 'error');
    }
  };

  const copyBookingLink = (slug: string) => {
    const url = `${window.location.origin}/book/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleCancelBooking = async (id: string) => {
    if (!confirm('Cancel this booking?')) return;
    try {
      await cancelBooking.mutateAsync(id);
      showToast('Booking cancelled', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to cancel booking'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Meeting Scheduling"
        description="Manage availability, booking pages, and scheduled meetings"
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(['availability', 'urls', 'bookings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab === 'availability' ? 'Availability' : tab === 'urls' ? 'Booking Pages' : 'Bookings'}
          </button>
        ))}
      </div>

      {/* Availability Tab */}
      {activeTab === 'availability' && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Weekly Availability</CardTitle>
              <Button size="sm" onClick={handleSaveAvailability} disabled={setAvailability.isPending}>
                {setAvailability.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
            <p className="text-sm text-slate-500">
              Set your available hours for each day of the week. Bookings can only be made during these windows.
            </p>

            <div className="space-y-3">
              {DAYS.map((day, index) => {
                const slot = editingAvail[index];
                return (
                  <div key={index} className="flex items-center gap-4 rounded-lg border border-slate-200 p-3">
                    <label className="flex items-center gap-2 w-20">
                      <input
                        type="checkbox"
                        checked={slot?.active ?? false}
                        onChange={(e) =>
                          setEditingAvail((prev) => ({
                            ...prev,
                            [index]: {
                              start: prev[index]?.start ?? '09:00',
                              end: prev[index]?.end ?? '17:00',
                              active: e.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-sm font-medium text-slate-700">{day}</span>
                    </label>

                    {slot?.active && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={slot.start}
                          onChange={(e) =>
                            setEditingAvail((prev) => ({
                              ...prev,
                              [index]: { ...prev[index], start: e.target.value },
                            }))
                          }
                          className="w-32"
                        />
                        <span className="text-sm text-slate-400">to</span>
                        <Input
                          type="time"
                          value={slot.end}
                          onChange={(e) =>
                            setEditingAvail((prev) => ({
                              ...prev,
                              [index]: { ...prev[index], end: e.target.value },
                            }))
                          }
                          className="w-32"
                        />
                      </div>
                    )}

                    {!slot?.active && (
                      <span className="text-sm text-slate-400">Unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Booking URLs Tab */}
      {activeTab === 'urls' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNewUrl(!showNewUrl)}>
              <Plus className="mr-2 h-4 w-4" /> New Booking Page
            </Button>
          </div>

          {showNewUrl && (
            <Card className="border-indigo-200 bg-indigo-50">
              <CardContent className="p-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Page Title</Label>
                    <Input
                      value={newUrlTitle}
                      onChange={(e) => setNewUrlTitle(e.target.value)}
                      placeholder="Book a meeting with me"
                    />
                  </div>
                  <Button onClick={handleCreateUrl} disabled={createUrl.isPending}>
                    Create
                  </Button>
                  <Button variant="outline" onClick={() => setShowNewUrl(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {loadingUrls ? (
            <LoadingTable rows={3} cols={4} />
          ) : urls?.data && urls.data.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {urls.data.map((url) => (
                <Card key={url.id}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-slate-900">{url.title}</h4>
                        <p className="mt-1 text-sm text-slate-500">/{url.slug}</p>
                      </div>
                      <StatusBadge tone={url.is_active ? 'green' : 'gray'}>
                        {url.is_active ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {url.max_advance_days}d advance
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> +{url.buffer_before_min}min buffer
                      </span>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => copyBookingLink(url.slug)}>
                        {copiedSlug === url.slug ? (
                          <Check className="mr-1 h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="mr-1 h-3 w-3" />
                        )}
                        Copy Link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`/book/${url.slug}`, '_blank')}
                      >
                        <ExternalLink className="mr-1 h-3 w-3" /> Preview
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Link2 className="h-6 w-6" />}
              title="No booking pages"
              description="Create a booking page to let prospects schedule meetings with you."
            />
          )}
        </div>
      )}

      {/* Bookings Tab */}
      {activeTab === 'bookings' && (
        <div className="space-y-4">
          {loadingBookings ? (
            <LoadingTable rows={5} cols={5} />
          ) : bookings?.data && bookings.data.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="px-4 py-3 font-medium text-slate-600">Booker</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Email</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Date & Time</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.data.map((b) => (
                      <tr key={b.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-900">{b.booker_name}</td>
                        <td className="px-4 py-3 text-slate-600">{b.booker_email}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(b.starts_at).toLocaleDateString()}{' '}
                          {new Date(b.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            tone={
                              b.status === 'confirmed'
                                ? 'green'
                                : b.status === 'completed'
                                  ? 'blue'
                                  : b.status === 'cancelled'
                                    ? 'red'
                                    : 'gray'
                            }
                          >
                            {b.status}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3">
                          {b.status === 'confirmed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600"
                              onClick={() => handleCancelBooking(b.id)}
                              disabled={cancelBooking.isPending}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<Calendar className="h-6 w-6" />}
              title="No bookings yet"
              description="Bookings will appear here once people start scheduling meetings."
            />
          )}
        </div>
      )}
    </div>
  );
}
