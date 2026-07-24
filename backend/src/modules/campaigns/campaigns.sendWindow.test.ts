import {
  computeSendWindowDelayMs,
  computeDelayToNextLocalMidnightMs,
  computeDispatchDeferralMs,
  isValidTimezone,
  sendWindowFromCampaign,
  SendWindowConfig,
} from './campaigns.sendWindow';
import { Campaign } from './campaigns.types';

jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const HOUR_MS = 60 * 60 * 1000;

function utcConfig(overrides: Partial<SendWindowConfig> = {}): SendWindowConfig {
  return {
    enabled: true,
    startHour: 9,
    endHour: 18,
    days: [1, 2, 3, 4, 5],
    timezone: 'UTC',
    ...overrides,
  };
}

function campaignWith(overrides: Partial<Campaign>): Campaign {
  return {
    id: 'c1',
    name: 'Test',
    status: 'active',
    tone: 'professional',
    target_industries: [],
    target_countries: [],
    sequence_id: 's1',
    pipeline_id: null,
    trigger_stage_id: null,
    trigger_source: null,
    trigger_tags: null,
    ai_personalization_enabled: false,
    autonomy_level: 'guarded',
    ai_min_confidence: 70,
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
    created_by: 'u1',
    launched_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// 2026-07-20 is a Monday.
const MONDAY_10_UTC = new Date(Date.UTC(2026, 6, 20, 10, 0, 0));
const MONDAY_6_UTC = new Date(Date.UTC(2026, 6, 20, 6, 0, 0));
const MONDAY_20_UTC = new Date(Date.UTC(2026, 6, 20, 20, 0, 0));
const FRIDAY_20_UTC = new Date(Date.UTC(2026, 6, 24, 20, 0, 0));
const SATURDAY_12_UTC = new Date(Date.UTC(2026, 6, 25, 12, 0, 0));

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects garbage', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });
});

describe('computeSendWindowDelayMs', () => {
  it('returns 0 when disabled', () => {
    expect(computeSendWindowDelayMs(utcConfig({ enabled: false }), MONDAY_20_UTC)).toBe(0);
  });

  it('returns 0 inside the window', () => {
    expect(computeSendWindowDelayMs(utcConfig(), MONDAY_10_UTC)).toBe(0);
  });

  it('defers to window start earlier the same day', () => {
    expect(computeSendWindowDelayMs(utcConfig(), MONDAY_6_UTC)).toBe(3 * HOUR_MS);
  });

  it('defers to next day start after the window closes', () => {
    // Monday 20:00 → Tuesday 09:00 = 13h
    expect(computeSendWindowDelayMs(utcConfig(), MONDAY_20_UTC)).toBe(13 * HOUR_MS);
  });

  it('skips the weekend for weekday-only windows', () => {
    // Friday 20:00 → Monday 09:00 = 61h
    expect(computeSendWindowDelayMs(utcConfig(), FRIDAY_20_UTC)).toBe(61 * HOUR_MS);
    // Saturday 12:00 → Monday 09:00 = 45h
    expect(computeSendWindowDelayMs(utcConfig(), SATURDAY_12_UTC)).toBe(45 * HOUR_MS);
  });

  it('honours the configured timezone', () => {
    // Monday 06:00 UTC = Monday 11:30 in Asia/Kolkata (UTC+5:30) → inside 9–18 window
    expect(
      computeSendWindowDelayMs(utcConfig({ timezone: 'Asia/Kolkata' }), MONDAY_6_UTC),
    ).toBe(0);
  });

  it('treats unsatisfiable or invalid configs as open (never blocks forever)', () => {
    expect(computeSendWindowDelayMs(utcConfig({ days: [] }), MONDAY_20_UTC)).toBe(0);
    expect(
      computeSendWindowDelayMs(utcConfig({ startHour: 18, endHour: 9 }), MONDAY_20_UTC),
    ).toBe(0);
    expect(
      computeSendWindowDelayMs(utcConfig({ timezone: 'Not/AZone' }), MONDAY_20_UTC),
    ).toBe(0);
  });

  it('rounds partial hours up to the opening boundary', () => {
    const monday0830 = new Date(Date.UTC(2026, 6, 20, 8, 30, 0));
    expect(computeSendWindowDelayMs(utcConfig(), monday0830)).toBe(30 * 60 * 1000);
  });
});

describe('computeDelayToNextLocalMidnightMs', () => {
  it('returns time to next UTC midnight for UTC', () => {
    expect(computeDelayToNextLocalMidnightMs('UTC', MONDAY_20_UTC)).toBe(4 * HOUR_MS);
  });

  it('falls back to UTC for invalid timezones', () => {
    expect(computeDelayToNextLocalMidnightMs('Not/AZone', MONDAY_20_UTC)).toBe(4 * HOUR_MS);
  });
});

describe('computeDispatchDeferralMs', () => {
  it('returns no deferral when nothing restricts the send', () => {
    const campaign = campaignWith({});
    expect(computeDispatchDeferralMs(campaign, null, MONDAY_10_UTC)).toEqual({
      delayMs: 0,
      reason: null,
    });
  });

  it('defers for the send window when outside it', () => {
    const campaign = campaignWith({ send_window_enabled: true });
    const result = computeDispatchDeferralMs(campaign, null, MONDAY_20_UTC);
    expect(result.reason).toBe('send_window');
    expect(result.delayMs).toBe(13 * HOUR_MS);
  });

  it('defers to the next day when the daily cap is reached', () => {
    const campaign = campaignWith({ daily_send_limit: 50 });
    const result = computeDispatchDeferralMs(campaign, 50, MONDAY_10_UTC);
    expect(result.reason).toBe('daily_cap');
    // Monday 10:00 → Tuesday 00:00 = 14h (no window configured)
    expect(result.delayMs).toBe(14 * HOUR_MS);
  });

  it('cap deferral also waits for the next window opening', () => {
    const campaign = campaignWith({ send_window_enabled: true, daily_send_limit: 50 });
    const result = computeDispatchDeferralMs(campaign, 50, MONDAY_10_UTC);
    expect(result.reason).toBe('daily_cap');
    // Monday 10:00 → Tuesday 00:00 (14h) → Tuesday 09:00 (+9h) = 23h
    expect(result.delayMs).toBe(23 * HOUR_MS);
  });

  it('does not apply the cap when under the limit', () => {
    const campaign = campaignWith({ daily_send_limit: 50 });
    expect(computeDispatchDeferralMs(campaign, 49, MONDAY_10_UTC)).toEqual({
      delayMs: 0,
      reason: null,
    });
  });
});

describe('sendWindowFromCampaign', () => {
  it('maps campaign columns and defaults missing values safely', () => {
    const campaign = campaignWith({
      send_window_enabled: true,
      send_window_days: undefined as unknown as number[],
      send_window_timezone: '',
    });
    const config = sendWindowFromCampaign(campaign);
    expect(config.days).toEqual([]);
    expect(config.timezone).toBe('UTC');
    expect(config.enabled).toBe(true);
  });
});
