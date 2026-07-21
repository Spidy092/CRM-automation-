import { resolveStageOutcome } from './leadOutcome';

describe('resolveStageOutcome', () => {
  it('marks won when the stage is terminal-won and the lead is not already won', () => {
    expect(resolveStageOutcome('active', { is_terminal_won: true, is_terminal_lost: false })).toBe(
      'won',
    );
  });

  it('marks lost when the stage is terminal-lost and the lead is not already lost', () => {
    expect(resolveStageOutcome('active', { is_terminal_won: false, is_terminal_lost: true })).toBe(
      'lost',
    );
  });

  it('returns null when already in the matching terminal status', () => {
    expect(resolveStageOutcome('won', { is_terminal_won: true, is_terminal_lost: false })).toBeNull();
    expect(resolveStageOutcome('lost', { is_terminal_won: false, is_terminal_lost: true })).toBeNull();
  });

  it('reopens a won or lost lead moved into a non-terminal stage', () => {
    expect(
      resolveStageOutcome('won', { is_terminal_won: false, is_terminal_lost: false }),
    ).toBe('active');
    expect(
      resolveStageOutcome('lost', { is_terminal_won: false, is_terminal_lost: false }),
    ).toBe('active');
  });

  it('reopens a won or lost lead when the stage is unset (null)', () => {
    expect(resolveStageOutcome('won', null)).toBe('active');
    expect(resolveStageOutcome('lost', null)).toBe('active');
  });

  it('returns null for an already-active lead in a non-terminal stage', () => {
    expect(
      resolveStageOutcome('active', { is_terminal_won: false, is_terminal_lost: false }),
    ).toBeNull();
    expect(resolveStageOutcome('active', null)).toBeNull();
  });

  it('does not reopen paused or opted_out leads moved to a non-terminal stage', () => {
    expect(
      resolveStageOutcome('paused', { is_terminal_won: false, is_terminal_lost: false }),
    ).toBeNull();
    expect(
      resolveStageOutcome('opted_out', { is_terminal_won: false, is_terminal_lost: false }),
    ).toBeNull();
  });
});
