import { useState, useEffect } from 'react';
import {
  useAvailability,
  useSetAvailability,
  useBookingUrls,
  useCreateBookingUrl,
  useBookings,
  useCancelBooking,
  useDateOverrides,
  useSetDateOverride,
  useDeleteDateOverride,
  useCreateInternalBooking,
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
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Settings,
} from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type BookingFilter = 'all' | 'upcoming' | 'past' | 'cancelled';

export function SchedulingPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'settings' | 'bookings'>('bookings');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Collapsible sections in Settings tab
  const [showAvailability, setShowAvailability] = useState(false);
  const [showDateOverrides, setShowDateOverrides] = useState(false);
  const [showBookingPages, setShowBookingPages] = useState(false);

  // Availability
  const { data: availability } = useAvailability();
  const setAvailability = useSetAvailability();

  // Date Overrides
  const { data: dateOverrides } = useDateOverrides();
  const setDateOverride = useSetDateOverride();
  const deleteDateOverride = useDeleteDateOverride();

  // Date Override Form
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Booking URLs
  const { data: urls, isLoading: loadingUrls } = useBookingUrls();
  const createUrl = useCreateBookingUrl();

  // Bookings & Internal Manual Scheduling
  const { data: bookings, isLoading: loadingBookings } = useBookings();
  const cancelBooking = useCancelBooking();
  const createInternalBooking = useCreateInternalBooking();

  // Booking filter
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>('upcoming');

  // Internal Schedule Form
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [internalName, setInternalName] = useState('');
  const [internalEmail, setInternalEmail] = useState('');
  const [internalPhone, setInternalPhone] = useState('');
  const [internalStartsAt, setInternalStartsAt] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [blockedDateWarning, setBlockedDateWarning] = useState<string | null>(null);

  // New URL form
  const [showNewUrl, setShowNewUrl] = useState(false);
  const [newUrlTitle, setNewUrlTitle] = useState('');

  // Availability editing (support multi-shift per day)
  const [editingAvail, setEditingAvail] = useState<
    Record<number, { active: boolean; shifts: Array<{ start: string; end: string }> }>
  >({});

  useEffect(() => {
    if (availability?.data) {
      const grouped: Record<number, { active: boolean; shifts: Array<{ start: string; end: string }> }> = {};
      for (const a of availability.data) {
        if (!grouped[a.day_of_week]) {
          grouped[a.day_of_week] = { active: a.is_active, shifts: [] };
        }
        if (a.is_active) {
          grouped[a.day_of_week].active = true;
          grouped[a.day_of_week].shifts.push({ start: a.start_time, end: a.end_time });
        }
      }
      for (let day = 0; day <= 6; day++) {
        if (!grouped[day]) {
          grouped[day] = { active: false, shifts: [{ start: '09:00', end: '17:00' }] };
        } else if (grouped[day].shifts.length === 0) {
          grouped[day].shifts = [{ start: '09:00', end: '17:00' }];
        }
      }
      setEditingAvail(grouped);
    }
  }, [availability]);

  // Filter bookings
  const filteredBookings = bookings?.data?.filter((b) => {
    const now = new Date();
    const startsAt = new Date(b.starts_at);
    switch (bookingFilter) {
      case 'upcoming':
        return b.status === 'confirmed' && startsAt >= now;
      case 'past':
        return b.status !== 'cancelled' && startsAt < now;
      case 'cancelled':
        return b.status === 'cancelled';
      default:
        return true;
    }
  }) ?? [];

  // Get primary booking URL for quick copy
  const primaryUrl = urls?.data?.find((u) => u.is_active) ?? urls?.data?.[0];

  const copyBookingLink = (slug: string) => {
    const url = `${window.location.origin}/book/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleSaveAvailability = async () => {
    const slots: AvailabilitySlot[] = [];
    for (const [dayStr, v] of Object.entries(editingAvail)) {
      if (!v.active) continue;
      const day = Number(dayStr);
      for (const shift of v.shifts) {
        if (shift.start >= shift.end) {
          showToast(`Invalid hours for ${DAYS[day]}: Start time must be before end time`, 'error');
          return;
        }
        slots.push({
          dayOfWeek: day,
          startTime: shift.start,
          endTime: shift.end,
          slotDurationMin: 30,
          isActive: true,
        });
      }
    }
    try {
      await setAvailability.mutateAsync(slots);
      showToast('Availability saved', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save availability'), 'error');
    }
  };

  const handleApplyPreset = (type: 'mon-fri' | 'all-days' | 'clear') => {
    const updated: Record<number, { active: boolean; shifts: Array<{ start: string; end: string }> }> = {};
    for (let day = 0; day <= 6; day++) {
      if (type === 'mon-fri') {
        const isWeekday = day >= 1 && day <= 5;
        updated[day] = { active: isWeekday, shifts: [{ start: '09:00', end: '17:00' }] };
      } else if (type === 'all-days') {
        updated[day] = { active: true, shifts: [{ start: '09:00', end: '17:00' }] };
      } else {
        updated[day] = { active: false, shifts: [{ start: '09:00', end: '17:00' }] };
      }
    }
    setEditingAvail(updated);
  };

  const handleAddShift = (day: number) => {
    setEditingAvail((prev) => {
      const currentShifts = prev[day]?.shifts ?? [];
      const lastEnd = currentShifts[currentShifts.length - 1]?.end ?? '12:00';
      return {
        ...prev,
        [day]: {
          active: true,
          shifts: [...currentShifts, { start: lastEnd, end: '17:00' }],
        },
      };
    });
  };

  const handleRemoveShift = (day: number, shiftIdx: number) => {
    setEditingAvail((prev) => {
      const currentShifts = prev[day]?.shifts ?? [];
      const updatedShifts = currentShifts.filter((_, idx) => idx !== shiftIdx);
      return {
        ...prev,
        [day]: {
          active: updatedShifts.length > 0 ? prev[day].active : false,
          shifts: updatedShifts.length > 0 ? updatedShifts : [{ start: '09:00', end: '17:00' }],
        },
      };
    });
  };

  // Check if a datetime falls on a blocked date
  const checkBlockedDate = (dateTimeStr: string) => {
    if (!dateTimeStr || !dateOverrides?.data) {
      setBlockedDateWarning(null);
      return;
    }
    const dateStr = new Date(dateTimeStr).toISOString().slice(0, 10);
    const blocked = dateOverrides.data.find((ov) => ov.is_blocked && ov.override_date === dateStr);
    if (blocked) {
      setBlockedDateWarning(
        `${blocked.override_date} is blocked${blocked.reason ? ` (${blocked.reason})` : ''}. The meeting will be scheduled anyway.`,
      );
    } else {
      setBlockedDateWarning(null);
    }
  };

  const handleScheduleInternalBooking = async () => {
    if (!internalName.trim() || !internalEmail.trim() || !internalStartsAt) {
      showToast('Name, Email, and Date/Time are required', 'error');
      return;
    }
    try {
      await createInternalBooking.mutateAsync({
        bookerName: internalName.trim(),
        bookerEmail: internalEmail.trim(),
        bookerPhone: internalPhone.trim() || undefined,
        startsAt: new Date(internalStartsAt).toISOString(),
        notes: internalNotes.trim() || undefined,
        forceOverride: !!blockedDateWarning,
      });
      showToast('Meeting scheduled & Google Calendar invite sent!', 'success');
      setShowScheduleForm(false);
      setInternalName('');
      setInternalEmail('');
      setInternalPhone('');
      setInternalStartsAt('');
      setInternalNotes('');
      setBlockedDateWarning(null);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to schedule meeting'), 'error');
    }
  };

  const handleAddOverride = async () => {
    if (!overrideDate) {
      showToast('Please select a date', 'error');
      return;
    }
    try {
      await setDateOverride.mutateAsync({
        overrideDate,
        isBlocked: true,
        reason: overrideReason.trim() || undefined,
      });
      showToast('Date blockout added', 'success');
      setOverrideDate('');
      setOverrideReason('');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to add date blockout'), 'error');
    }
  };

  const handleDeleteOverride = async (id: string) => {
    try {
      await deleteDateOverride.mutateAsync(id);
      showToast('Date blockout removed', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to remove date blockout'), 'error');
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

  const handleCancelBooking = async (id: string) => {
    if (!confirm('Cancel this booking?')) return;
    try {
      await cancelBooking.mutateAsync(id);
      showToast('Booking cancelled', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to cancel booking'), 'error');
    }
  };

  const FILTER_LABELS: Record<BookingFilter, string> = {
    all: 'All',
    upcoming: 'Upcoming',
    past: 'Past',
    cancelled: 'Cancelled',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Meeting Scheduling"
        description="Manage availability, booking pages, and scheduled meetings"
      />

      {/* Quick Copy Booking Link */}
      {primaryUrl && (
        <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
          <Link2 className="h-4 w-4 text-indigo-600 shrink-0" />
          <span className="text-sm text-slate-700">Your booking link:</span>
          <code className="flex-1 rounded bg-white px-3 py-1 text-sm font-mono text-indigo-700 border border-indigo-100">
            {window.location.origin}/book/{primaryUrl.slug}
          </code>
          <Button
            size="sm"
            variant={copiedSlug === primaryUrl.slug ? 'default' : 'outline'}
            className={copiedSlug === primaryUrl.slug ? 'bg-green-600 hover:bg-green-700' : ''}
            onClick={() => copyBookingLink(primaryUrl.slug)}
          >
            {copiedSlug === primaryUrl.slug ? (
              <><Check className="mr-1 h-3 w-3" /> Copied</>
            ) : (
              <><Copy className="mr-1 h-3 w-3" /> Copy</>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/book/${primaryUrl.slug}`, '_blank')}
          >
            <ExternalLink className="mr-1 h-3 w-3" /> Preview
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(['bookings', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center justify-center gap-2 flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab === 'bookings' ? (
              <><Calendar className="h-4 w-4" /> Bookings</>
            ) : (
              <><Settings className="h-4 w-4" /> Settings</>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BOOKINGS TAB */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'bookings' && (
        <div className="space-y-4">
          {/* Top bar: filter + schedule button */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              {(Object.keys(FILTER_LABELS) as BookingFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setBookingFilter(f)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    bookingFilter === f
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setShowScheduleForm(!showScheduleForm)}>
              <Plus className="mr-1 h-4 w-4" /> Schedule for Client
            </Button>
          </div>

          {/* Inline schedule form (collapsible) */}
          {showScheduleForm && (
            <Card className="border-indigo-200 bg-indigo-50/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-900 text-sm">Schedule on Behalf of Client</h4>
                  <Button variant="ghost" size="sm" onClick={() => { setShowScheduleForm(false); setBlockedDateWarning(null); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name *</Label>
                    <Input placeholder="John Doe" value={internalName} onChange={(e) => setInternalName(e.target.value)} className="bg-white" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email *</Label>
                    <Input type="email" placeholder="client@company.com" value={internalEmail} onChange={(e) => setInternalEmail(e.target.value)} className="bg-white" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input type="tel" placeholder="+1 (555) 000-0000" value={internalPhone} onChange={(e) => setInternalPhone(e.target.value)} className="bg-white" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date & Time *</Label>
                    <Input
                      type="datetime-local"
                      value={internalStartsAt}
                      onChange={(e) => {
                        setInternalStartsAt(e.target.value);
                        checkBlockedDate(e.target.value);
                      }}
                      className="bg-white"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Input placeholder="Q3 Strategy Overview" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className="bg-white" />
                  </div>
                </div>

                {/* Contextual blocked-date warning */}
                {blockedDateWarning && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span>{blockedDateWarning}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowScheduleForm(false); setBlockedDateWarning(null); }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleScheduleInternalBooking} disabled={createInternalBooking.isPending}>
                    {createInternalBooking.isPending ? 'Scheduling...' : 'Schedule & Send Invite'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bookings table */}
          {loadingBookings ? (
            <LoadingTable rows={5} cols={5} />
          ) : filteredBookings.length > 0 ? (
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
                    {filteredBookings.map((b) => (
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
              title={bookingFilter === 'all' ? 'No bookings yet' : `No ${bookingFilter} bookings`}
              description={
                bookingFilter === 'upcoming'
                  ? 'Upcoming confirmed meetings will appear here.'
                  : 'Bookings will appear here once people start scheduling meetings.'
              }
            />
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SETTINGS TAB */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'settings' && (
        <div className="space-y-4">

          {/* ── Booking Pages (collapsible) ────────────────────────── */}
          <Card>
            <button
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => setShowBookingPages(!showBookingPages)}
            >
              <div className="flex items-center gap-3">
                <Link2 className="h-5 w-5 text-slate-500" />
                <div>
                  <CardTitle className="text-base">Booking Pages</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {urls?.data?.length ?? 0} page{urls?.data?.length !== 1 ? 's' : ''} created
                  </p>
                </div>
              </div>
              {showBookingPages ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>

            {showBookingPages && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setShowNewUrl(!showNewUrl)}>
                    <Plus className="mr-1 h-3 w-3" /> New Page
                  </Button>
                </div>

                {showNewUrl && (
                  <div className="flex items-end gap-3 rounded-lg bg-slate-50 p-3 border border-slate-200">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Page Title</Label>
                      <Input value={newUrlTitle} onChange={(e) => setNewUrlTitle(e.target.value)} placeholder="Book a meeting with me" />
                    </div>
                    <Button size="sm" onClick={handleCreateUrl} disabled={createUrl.isPending}>Create</Button>
                    <Button size="sm" variant="outline" onClick={() => setShowNewUrl(false)}>Cancel</Button>
                  </div>
                )}

                {loadingUrls ? (
                  <LoadingTable rows={2} cols={2} />
                ) : urls?.data && urls.data.length > 0 ? (
                  <div className="space-y-2">
                    {urls.data.map((url) => (
                      <div key={url.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center gap-3">
                          <div>
                            <span className="text-sm font-medium text-slate-900">{url.title}</span>
                            <span className="text-xs text-slate-400 ml-2">/{url.slug}</span>
                          </div>
                          <StatusBadge tone={url.is_active ? 'green' : 'gray'}>
                            {url.is_active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" /> {url.max_advance_days}d
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> +{url.buffer_before_min}min
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">No booking pages yet.</p>
                )}
              </div>
            )}
          </Card>

          {/* ── Weekly Availability (collapsible) ──────────────────── */}
          <Card>
            <button
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => setShowAvailability(!showAvailability)}
            >
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-slate-500" />
                <div>
                  <CardTitle className="text-base">Weekly Availability</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {Object.values(editingAvail).filter((d) => d.active).length} days active
                  </p>
                </div>
              </div>
              {showAvailability ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>

            {showAvailability && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                {/* Presets */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quick set:</span>
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApplyPreset('mon-fri')}>
                    Mon–Fri 9–5
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApplyPreset('all-days')}>
                    All Days 9–5
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-slate-400 hover:text-red-600" onClick={() => handleApplyPreset('clear')}>
                    Clear
                  </Button>
                </div>

                {/* Day rows */}
                <div className="space-y-2">
                  {DAYS.map((day, index) => {
                    const dayAvail = editingAvail[index] ?? { active: false, shifts: [{ start: '09:00', end: '17:00' }] };
                    return (
                      <div key={index} className="flex items-center gap-3">
                        <label className="flex items-center gap-2 w-20 shrink-0">
                          <input
                            type="checkbox"
                            checked={dayAvail.active}
                            onChange={(e) =>
                              setEditingAvail((prev) => ({
                                ...prev,
                                [index]: {
                                  ...prev[index],
                                  active: e.target.checked,
                                  shifts: prev[index]?.shifts?.length ? prev[index].shifts : [{ start: '09:00', end: '17:00' }],
                                },
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="text-sm font-medium text-slate-700">{day}</span>
                        </label>

                        {dayAvail.active ? (
                          <>
                            {dayAvail.shifts.map((shift, shiftIdx) => (
                              <div key={shiftIdx} className="flex items-center gap-1">
                                <Input
                                  type="time"
                                  value={shift.start}
                                  onChange={(e) =>
                                    setEditingAvail((prev) => {
                                      const shifts = [...(prev[index]?.shifts ?? [])];
                                      shifts[shiftIdx] = { ...shifts[shiftIdx], start: e.target.value };
                                      return { ...prev, [index]: { ...prev[index], shifts } };
                                    })
                                  }
                                  className="w-28 h-8 text-xs"
                                />
                                <span className="text-xs text-slate-400">–</span>
                                <Input
                                  type="time"
                                  value={shift.end}
                                  onChange={(e) =>
                                    setEditingAvail((prev) => {
                                      const shifts = [...(prev[index]?.shifts ?? [])];
                                      shifts[shiftIdx] = { ...shifts[shiftIdx], end: e.target.value };
                                      return { ...prev, [index]: { ...prev[index], shifts } };
                                    })
                                  }
                                  className="w-28 h-8 text-xs"
                                />
                                {dayAvail.shifts.length > 1 && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                                    onClick={() => handleRemoveShift(index, shiftIdx)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-indigo-600 hover:text-indigo-800 shrink-0"
                              onClick={() => handleAddShift(index)}
                            >
                              <Plus className="mr-0.5 h-3 w-3" /> Add
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Unavailable</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end pt-1">
                  <Button size="sm" onClick={handleSaveAvailability} disabled={setAvailability.isPending}>
                    {setAvailability.isPending ? 'Saving...' : 'Save Availability'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* ── Date Blockouts (collapsible) ───────────────────────── */}
          <Card>
            <button
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => setShowDateOverrides(!showDateOverrides)}
            >
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-slate-500" />
                <div>
                  <CardTitle className="text-base">Date Blockouts</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {dateOverrides?.data?.length ?? 0} date{dateOverrides?.data?.length !== 1 ? 's' : ''} blocked
                  </p>
                </div>
              </div>
              {showDateOverrides ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>

            {showDateOverrides && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3 border border-slate-200">
                  <div className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} className="w-40 bg-white h-8 text-xs" />
                  </div>
                  <div className="flex-1 space-y-1 min-w-[160px]">
                    <Label className="text-xs">Reason</Label>
                    <Input type="text" placeholder="Holiday / Vacation" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="bg-white h-8 text-xs" />
                  </div>
                  <Button size="sm" className="h-8 text-xs" onClick={handleAddOverride} disabled={setDateOverride.isPending}>
                    <Plus className="mr-1 h-3 w-3" /> Block Date
                  </Button>
                </div>

                {dateOverrides?.data && dateOverrides.data.length > 0 ? (
                  <div className="space-y-1">
                    {dateOverrides.data.map((ov) => (
                      <div key={ov.id} className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-sm font-medium text-slate-900">{ov.override_date}</span>
                          {ov.reason && <span className="text-xs text-slate-500">({ov.reason})</span>}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                          onClick={() => handleDeleteOverride(ov.id)}
                          disabled={deleteDateOverride.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No dates blocked yet.</p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
