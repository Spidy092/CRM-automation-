import { normalizePhone, isE164 } from './phone';

describe('normalizePhone', () => {
  it('normalizes a spaced international number', () => {
    expect(normalizePhone('+1 234 567 8901')).toBe('+12345678901');
  });

  it('converts 00 international prefix to +', () => {
    expect(normalizePhone('0044 20 7946 0958')).toBe('+442079460958');
  });

  it('prefixes + to a digits-only string', () => {
    expect(normalizePhone('1234567890')).toBe('+1234567890');
  });

  it('strips dashes and parentheses', () => {
    expect(normalizePhone('(123) 456-7890')).toBe('+1234567890');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });

  it('returns cleaned original for non-numeric junk', () => {
    expect(normalizePhone('abc')).toBe('abc');
  });

  it('returns cleaned value when too short for E.164', () => {
    expect(normalizePhone('+12345')).toBe('+12345');
  });

  it('returns cleaned value when too long for E.164', () => {
    expect(normalizePhone('+1234567890123456')).toBe('+1234567890123456');
  });
});

describe('isE164', () => {
  it('is true for valid E.164', () => {
    expect(isE164('+1234567890')).toBe(true);
  });

  it('is false without a plus', () => {
    expect(isE164('1234567890')).toBe(false);
  });

  it('is false when too short', () => {
    expect(isE164('+12345')).toBe(false);
  });

  it('is false for empty', () => {
    expect(isE164('')).toBe(false);
  });
});
