/**
 * Campaign scheduling calculations — pure-function regression coverage.
 *
 * Covers the verification matrix that needs no database: pause/resume
 * preserving remaining delay, timezones/DST/weekends/midnight, consistent
 * reporting under repeated/out-of-order events, and the first-step policy.
 */
import {
  computeScheduledDueAt,
  computeResumeDueAt,
  freezeRemainingDelay,
  describeWaitingReason,
  computePotentialRemaining,
  reconcileLogCounts,
  isSentLog,
  firstStepDelayIssue,
  formatDueInTimezone,
} from './campaigns.scheduling';
import type { Campaign } from './campaigns.types';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    name: 'Test',
    status: 'active',
    tone: 'professional',
    target_industries: [],
    target_countries: [],
    sequence_id: 'seq-1',
    pipeline_id: null,
    trigger_stage_id: null,
    trigger_source: null,
    trigger_tags: null,
    ai_personalization_enabled: false,
    autonomy_level: 'guarded',
    ai_min_confidence: 0,
    ab_test_enabled: false,
    ab_test_metric: 'open_rate',
    ab_test_min_samples: 100,
    ab_test_confidence: 95,
    ab_test_auto_promote: true,
    send_window_enabled: false,
    send_window_start_hour: 9,
    send_window_end_hour: 18,
    send_window_days: [1, 2, 3, 4, 5],
    send_window_timezone: 'UTC',
    daily_send_limit: null,
    created_by: 'admin-1',
    launched_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeScheduledDueAt', () => {
  it('sends immediately inside the window when no delay applies', () => {
    const base = new Date('2026-10-13T10:00:00.000Z'); // Tuesday
    const due = computeScheduledDueAt({ baseTime: base, delayMs: 0, campaign: campaign(), sentToday: null, now: base });
    expect(due.dueAt).toBe(base.toISOString());
    expect(due.deferralReason).toBeNull();
  });

  it('starts later-step delay from provider acceptance and applies the window', () => {
    const camp = campaign({
      send_window_enabled: true,
      send_window_start_hour: 9,
      send_window_end_hour: 17,
      send_window_days: [1, 2, 3, 4, 5],
      send_window_timezone: 'UTC',
    });
    // Accepted Friday 16:00 UTC + 2h delay = 18:00 (outside) → Monday 09:00.
    const base = new Date('2026-10-16T16:00:00.000Z');
    const due = computeScheduledDueAt({
      baseTime: base,
      delayMs: 2 * 3_600_000,
      campaign: camp,
      sentToday: null,
      now: base,
    });
    expect(due.dueAt).toBe('2026-10-19T09:00:00.000Z');
    expect(due.deferralReason).toBe('send_window');
  });

  it('never schedules earlier than the eligible time', () => {
    const base = new Date('2026-10-13T10:00:00.000Z');
    const due = computeScheduledDueAt({
      baseTime: base,
      delayMs: 60_000,
      campaign: campaign(),
      sentToday: null,
      now: base,
    });
    expect(new Date(due.dueAt).getTime()).toBeGreaterThanOrEqual(base.getTime() + 60_000);
  });

  it('defers to the next local midnight when the daily cap is reached', () => {
    const camp = campaign({ daily_send_limit: 50 });
    const base = new Date('2026-10-13T10:00:00.000Z');
    const due = computeScheduledDueAt({
      baseTime: base,
      delayMs: 0,
      campaign: camp,
      sentToday: 50,
      now: base,
    });
    expect(due.deferralReason).toBe('daily_cap');
    expect(due.dueAt).toBe('2026-10-14T00:00:00.000Z');
  });

  it('applies the window on top of the post-midnight cap reset', () => {
    const camp = campaign({
      daily_send_limit: 10,
      send_window_enabled: true,
      send_window_start_hour: 9,
      send_window_end_hour: 18,
      send_window_days: [1, 2, 3, 4, 5],
      send_window_timezone: 'UTC',
    });
    const base = new Date('2026-10-13T16:00:00.000Z');
    const due = computeScheduledDueAt({
      baseTime: base,
      delayMs: 0,
      campaign: camp,
      sentToday: 10,
      now: base,
    });
    expect(due.dueAt).toBe('2026-10-14T09:00:00.000Z');
    expect(due.deferralReason).toBe('daily_cap');
  });
});

describe('freezeRemainingDelay / computeResumeDueAt', () => {
  it('a one-hour delay paused after forty minutes resumes with twenty remaining', () => {
    const dueAt = new Date('2026-10-13T11:00:00.000Z');
    const pausedAt = new Date('2026-10-13T10:40:00.000Z');
    expect(freezeRemainingDelay(dueAt, pausedAt)).toBe(20 * 60_000);
  });

  it('an already-elapsed delay freezes at zero instead of going negative', () => {
    const dueAt = new Date('2026-10-13T10:00:00.000Z');
    const pausedAt = new Date('2026-10-13T10:40:00.000Z');
    expect(freezeRemainingDelay(dueAt, pausedAt)).toBe(0);
  });

  it('resume reapplies the sending window to the preserved remainder', () => {
    const camp = campaign({
      send_window_enabled: true,
      send_window_start_hour: 9,
      send_window_end_hour: 17,
      send_window_days: [1, 2, 3, 4, 5],
      send_window_timezone: 'UTC',
    });
    // 20 minutes remain but resume lands Friday 16:50 → window pushes to Monday 09:00.
    const due = computeResumeDueAt({
      remainingMs: 20 * 60_000,
      resumedAt: new Date('2026-10-16T16:50:00.000Z'),
      campaign: camp,
      sentToday: null,
    });
    expect(due.dueAt).toBe('2026-10-19T09:00:00.000Z');
    expect(due.deferralReason).toBe('send_window');
  });

  it('resume recomputes capacity against current usage, not a frozen reset date', () => {
    const camp = campaign({ daily_send_limit: 5 });
    const due = computeResumeDueAt({
      remainingMs: 0,
      resumedAt: new Date('2026-10-13T10:00:00.000Z'),
      campaign: camp,
      sentToday: 5,
    });
    expect(due.dueAt).toBe('2026-10-14T00:00:00.000Z');
    expect(due.deferralReason).toBe('daily_cap');
  });

  it('repeated pause/resume does not duplicate or reset work', () => {
    const camp = campaign();
    const first = computeResumeDueAt({
      remainingMs: 20 * 60_000,
      resumedAt: new Date('2026-10-13T10:00:00.000Z'),
      campaign: camp,
      sentToday: null,
    });
    const refrozen = freezeRemainingDelay(new Date(first.dueAt), new Date('2026-10-13T10:10:00.000Z'));
    expect(refrozen).toBe(10 * 60_000);
    const second = computeResumeDueAt({
      remainingMs: refrozen,
      resumedAt: new Date('2026-10-13T10:10:00.000Z'),
      campaign: camp,
      sentToday: null,
    });
    expect(second.dueAt).toBe(first.dueAt);
  });
});

describe('timezones, DST, weekends, midnight', () => {
  it('handles half-hour timezones (Asia/Kolkata): 03:30 UTC is inside a 9–18 IST window', () => {
    const camp = campaign({
      send_window_enabled: true,
      send_window_start_hour: 9,
      send_window_end_hour: 18,
      send_window_days: [1, 2, 3, 4, 5],
      send_window_timezone: 'Asia/Kolkata',
    });
    const at = new Date('2026-10-13T03:30:00.000Z'); // 09:00 IST Tuesday
    const due = computeScheduledDueAt({ baseTime: at, delayMs: 0, campaign: camp, sentToday: null, now: at });
    expect(due.dueAt).toBe(at.toISOString());
  });

  it('skips weekends: Friday evening defers to Monday morning', () => {
    const camp = campaign({
      send_window_enabled: true,
      send_window_start_hour: 9,
      send_window_end_hour: 18,
      send_window_days: [1, 2, 3, 4, 5],
      send_window_timezone: 'UTC',
    });
    const friday = new Date('2026-10-16T19:00:00.000Z');
    const due = computeScheduledDueAt({ baseTime: friday, delayMs: 0, campaign: camp, sentToday: null, now: friday });
    expect(due.dueAt).toBe('2026-10-19T09:00:00.000Z');
  });

  it('crosses midnight boundaries on cap reset in the campaign timezone', () => {
    const camp = campaign({ daily_send_limit: 1, send_window_timezone: 'Asia/Kolkata' });
    // 2026-10-13T18:30:00Z = 2026-10-14 00:00 IST — the cap day already rolled over locally.
    const at = new Date('2026-10-13T18:29:00.000Z'); // 23:59 IST
    const due = computeScheduledDueAt({ baseTime: at, delayMs: 0, campaign: camp, sentToday: 1, now: at });
    expect(due.deferralReason).toBe('daily_cap');
    expect(new Date(due.dueAt).getTime()).toBeGreaterThan(at.getTime());
  });

  it('survives a DST spring-forward without scheduling inside the missing hour', () => {
    const camp = campaign({
      send_window_enabled: true,
      send_window_start_hour: 9,
      send_window_end_hour: 18,
      send_window_days: [1, 2, 3, 4, 5, 6, 7],
      send_window_timezone: 'America/New_York',
    });
    // 2026-03-08 is the US spring-forward (02:00 → 03:00).
    const at = new Date('2026-03-08T04:00:00.000Z'); // 23:00 EST previous evening
    const due = computeScheduledDueAt({ baseTime: at, delayMs: 0, campaign: camp, sentToday: null, now: at });
    expect(new Date(due.dueAt).getTime()).toBeGreaterThanOrEqual(at.getTime());
    // Next 09:00 local after the transition is EDT (UTC-4) → 13:00Z.
    expect(due.dueAt).toBe('2026-03-08T13:00:00.000Z');
  });
});

describe('describeWaitingReason', () => {
  const base = {
    campaignStatus: 'active' as const,
    enrollmentPaused: false,
    hasCommittedNextStep: true,
    nextStepChannel: 'email',
    nextStepIsManualTask: false,
    deferralReason: null as null,
    sequenceDelayRemainingMs: 0,
    retryBackoffRemainingMs: 0,
    senderReady: true,
    schedulingAvailable: true,
    reviewRequired: false,
  };
  it('maps campaign and enrollment pauses independently', () => {
    expect(describeWaitingReason({ ...base, campaignStatus: 'paused' })).toBe('campaign_paused');
    expect(describeWaitingReason({ ...base, enrollmentPaused: true })).toBe('enrollment_paused');
  });
  it('prefers review, availability, and sender states over timing', () => {
    expect(describeWaitingReason({ ...base, reviewRequired: true })).toBe('review_required');
    expect(describeWaitingReason({ ...base, schedulingAvailable: false })).toBe('scheduling_unavailable');
    expect(describeWaitingReason({ ...base, senderReady: false })).toBe('sender_unavailable');
    expect(describeWaitingReason({ ...base, retryBackoffRemainingMs: 5_000 })).toBe('retry_backoff');
  });
  it('reports manual tasks, caps, windows, and sequence delays', () => {
    expect(describeWaitingReason({ ...base, nextStepIsManualTask: true })).toBe('manual_task_pending');
    expect(describeWaitingReason({ ...base, deferralReason: 'daily_cap' })).toBe('daily_limit');
    expect(describeWaitingReason({ ...base, deferralReason: 'send_window' })).toBe('outside_sending_hours');
    expect(describeWaitingReason({ ...base, sequenceDelayRemainingMs: 60_000 })).toBe('sequence_delay');
  });
  it('returns null when nothing is waiting', () => {
    expect(describeWaitingReason({ ...base, hasCommittedNextStep: false })).toBeNull();
  });
});

describe('reporting consistency', () => {
  it('sent messages stay sent after becoming opened or replied', () => {
    expect(isSentLog({ sent_at: '2026-10-01T00:00:00Z', delivered_at: null, opened_at: null, replied_at: null, status: 'opened' })).toBe(true);
    const counts = reconcileLogCounts([
      { sent_at: '2026-10-01T00:00:00Z', delivered_at: null, opened_at: '2026-10-02T00:00:00Z', replied_at: null, status: 'opened' },
      { sent_at: '2026-10-01T00:00:00Z', delivered_at: '2026-10-01T01:00:00Z', opened_at: '2026-10-02T00:00:00Z', replied_at: '2026-10-03T00:00:00Z', status: 'replied' },
      { sent_at: null, delivered_at: null, opened_at: null, replied_at: null, status: 'failed' },
    ]);
    expect(counts).toEqual({
      attempts: 3,
      sent: 2,
      delivered: 1,
      opened: 2,
      replied: 1,
      failed: 1,
      unresolvedFailed: 1,
    });
  });

  it('reconciles repeated and out-of-order events without inventing delivery', () => {
    const counts = reconcileLogCounts([
      { sent_at: '2026-10-01T00:00:00Z', delivered_at: null, opened_at: '2026-10-02T00:00:00Z', replied_at: null, status: 'opened' },
      { sent_at: '2026-10-01T00:00:00Z', delivered_at: null, opened_at: '2026-10-02T00:00:00Z', replied_at: null, status: 'opened' },
    ]);
    // Opened without delivered tracking: delivered stays 0 (unknown), never inferred.
    expect(counts.delivered).toBe(0);
    expect(counts.opened).toBe(2);
    expect(counts.sent).toBe(2);
  });
});

describe('computePotentialRemaining', () => {
  it('counts every step after the last completed one', () => {
    expect(computePotentialRemaining({ totalSteps: 4, completedSteps: 1, terminal: false })).toBe(3);
  });
  it('terminal enrollments contribute zero', () => {
    expect(computePotentialRemaining({ totalSteps: 4, completedSteps: 1, terminal: true })).toBe(0);
  });
  it('clamps over-completion to zero', () => {
    expect(computePotentialRemaining({ totalSteps: 2, completedSteps: 5, terminal: false })).toBe(0);
  });
});

describe('firstStepDelayIssue', () => {
  it('accepts immediate and unset first steps', () => {
    expect(firstStepDelayIssue(0)).toBeNull();
    expect(firstStepDelayIssue(null)).toBeNull();
    expect(firstStepDelayIssue(undefined)).toBeNull();
  });
  it('rejects nonzero first-step delays explicitly instead of ignoring them', () => {
    expect(firstStepDelayIssue(24)).toMatch(/scheduled first-step/i);
  });
});

describe('formatDueInTimezone', () => {
  it('labels the estimate with the campaign timezone', () => {
    const label = formatDueInTimezone('2026-10-13T07:00:00.000Z', 'Asia/Kolkata');
    expect(label).toContain('Asia/Kolkata');
    expect(label).toMatch(/12:30/);
  });
  it('falls back to UTC for invalid timezones', () => {
    expect(formatDueInTimezone('2026-10-13T07:00:00.000Z', 'Not/AZone')).toContain('UTC');
  });
});


describe('daily cap across campaign-local days', () => {
  it.each(['UTC', 'Asia/Kolkata', 'America/New_York'])(
    'does not add a day to delayed scheduling or resume in %s', (timezone) => {
      const now = new Date('2026-10-13T16:00:00.000Z');
      const delayMs = 24 * 3_600_000;
      const camp = campaign({ daily_send_limit: 1, send_window_timezone: timezone });
      const expected = new Date(now.getTime() + delayMs).toISOString();
      expect(computeScheduledDueAt({ baseTime: now, delayMs, campaign: camp, sentToday: 1, now }).dueAt).toBe(expected);
      expect(computeResumeDueAt({ remainingMs: delayMs, resumedAt: now, campaign: camp, sentToday: 1 }).dueAt).toBe(expected);
    },
  );
});
