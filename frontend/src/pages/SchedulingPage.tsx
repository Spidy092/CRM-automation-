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
} from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SchedulingPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'availability' | 'urls' | 'bookings'>('availability');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

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

  // Internal Schedule Form
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [internalName, setInternalName] = useState('');
  const [internalEmail, setInternalEmail] = useState('');
  const [internalPhone, setInternalPhone] = useState('');
  const [internalStartsAt, setInternalStartsAt] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [internalForceOverride, setInternalForceOverride] = useState(false);

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
      // Guarantee at least 1 default shift if active
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
        forceOverride: internalForceOverride,
      });
      showToast('Meeting scheduled & Google Calendar invite sent!', 'success');
      setShowScheduleModal(false);
      setInternalName('');
      setInternalEmail('');
      setInternalPhone('');
      setInternalStartsAt('');
      setInternalNotes('');
      setInternalForceOverride(false);
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
        <div className="space-y-6">
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

            {/* Quick Presets Toolbar */}
            <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Presets:</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium"
                onClick={() => handleApplyPreset('mon-fri')}
              >
                Mon–Fri (9 AM – 5 PM)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium"
                onClick={() => handleApplyPreset('all-days')}
              >
                All Days (9 AM – 5 PM)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs font-medium text-slate-500 hover:text-red-600"
                onClick={() => handleApplyPreset('clear')}
              >
                Clear All
              </Button>
            </div>

            <div className="space-y-3">
              {DAYS.map((day, index) => {
                const dayAvail = editingAvail[index] ?? { active: false, shifts: [{ start: '09:00', end: '17:00' }] };
                const blockedDatesForDay = dateOverrides?.data?.filter((ov) => {
                  if (!ov.is_blocked || !ov.override_date) return false;
                  const d = new Date(ov.override_date + 'T00:00:00Z');
                  return d.getUTCDay() === index;
                }) ?? [];

                return (
                  <div key={index} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2">
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
                          <span className="text-sm font-semibold text-slate-800">{day}</span>
                        </label>

                        {blockedDatesForDay.length > 0 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200"
                            title={blockedDatesForDay
                              .map((b) => `${b.override_date}${b.reason ? ' (' + b.reason + ')' : ''}`)
                              .join(', ')}
                          >
                            <AlertCircle className="h-3 w-3 text-amber-500" />
                            {blockedDatesForDay.length} date blockout active ({blockedDatesForDay.map((b) => b.override_date).join(', ')})
                          </span>
                        )}
                      </div>

                      {dayAvail.active && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-indigo-600 hover:text-indigo-800"
                          onClick={() => handleAddShift(index)}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Add Shift Window
                        </Button>
                      )}
                    </div>

                    {dayAvail.active ? (
                      <div className="space-y-2 pl-6">
                        {dayAvail.shifts.map((shift, shiftIdx) => (
                          <div key={shiftIdx} className="flex items-center gap-2">
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
                              className="w-32"
                            />
                            <span className="text-sm text-slate-400">to</span>
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
                              className="w-32"
                            />
                            {dayAvail.shifts.length > 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 text-slate-400 hover:text-red-600"
                                onClick={() => handleRemoveShift(index, shiftIdx)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400 pl-6">Unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Date Overrides & Blockout Holidays Card */}
        <Card className="mt-6">
          <CardContent className="p-5 space-y-4">
            <div>
              <CardTitle className="text-base">Date Blockouts & Exceptions</CardTitle>
              <p className="text-sm text-slate-500 mt-1">
                Block specific dates for holidays, vacations, or sick days to override your regular 9-to-5 weekly schedule.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-4 border border-slate-200">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                  className="w-44 bg-white"
                />
              </div>
              <div className="flex-1 space-y-1 min-w-[200px]">
                <Label className="text-xs">Reason (optional)</Label>
                <Input
                  type="text"
                  placeholder="e.g., Public Holiday / Vacation"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="bg-white"
                />
              </div>
              <Button
                size="sm"
                onClick={handleAddOverride}
                disabled={setDateOverride.isPending}
              >
                <Plus className="mr-1 h-4 w-4" /> Block Date
              </Button>
            </div>

            {/* List of Overrides */}
            {dateOverrides?.data && dateOverrides.data.length > 0 ? (
              <div className="space-y-2">
                {dateOverrides.data.map((ov) => (
                  <div
                    key={ov.id}
                    className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <div>
                        <span className="text-sm font-semibold text-slate-900">{ov.override_date}</span>
                        {ov.reason && <span className="text-xs text-slate-500 ml-2">({ov.reason})</span>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-slate-400 hover:text-red-600"
                      onClick={() => handleDeleteOverride(ov.id)}
                      disabled={deleteDateOverride.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No specific dates blocked yet.</p>
            )}
          </CardContent>
        </Card>
        </div>
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
          <div className="flex justify-end">
            <Button onClick={() => setShowScheduleModal(!showScheduleModal)}>
              <Plus className="mr-2 h-4 w-4" /> Schedule Meeting for Client
            </Button>
          </div>

          {showScheduleModal && (
            <Card className="border-indigo-200 bg-indigo-50/50">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
                  <h4 className="font-semibold text-slate-900 text-sm">Schedule Meeting on Behalf of Client</h4>
                  <Button variant="ghost" size="sm" onClick={() => setShowScheduleModal(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Client / Booker Name *</Label>
                    <Input
                      placeholder="e.g. John Doe"
                      value={internalName}
                      onChange={(e) => setInternalName(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Client Email (Receives Google Calendar Invite) *</Label>
                    <Input
                      type="email"
                      placeholder="client@company.com"
                      value={internalEmail}
                      onChange={(e) => setInternalEmail(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Client Phone (optional)</Label>
                    <Input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={internalPhone}
                      onChange={(e) => setInternalPhone(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date & Time *</Label>
                    <Input
                      type="datetime-local"
                      value={internalStartsAt}
                      onChange={(e) => setInternalStartsAt(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">Meeting Notes / Agenda</Label>
                    <Input
                      placeholder="e.g., Q3 Strategy Overview"
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={internalForceOverride}
                      onChange={(e) => setInternalForceOverride(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span className="text-xs font-medium text-slate-700">
                      Force schedule outside standard availability / holidays
                    </span>
                  </label>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowScheduleModal(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleScheduleInternalBooking}
                      disabled={createInternalBooking.isPending}
                    >
                      {createInternalBooking.isPending ? 'Scheduling & Inviting...' : 'Schedule & Send Invite'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
