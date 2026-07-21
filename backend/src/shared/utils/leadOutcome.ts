export type LeadOutcomeStatus = 'won' | 'lost' | 'active';

export interface StageOutcomeFlags {
  is_terminal_won: boolean;
  is_terminal_lost: boolean;
}

/**
 * Decides whether a lead's status should change as a side effect of moving
 * into (or out of) a terminal pipeline stage.
 *
 *   - Moving into an is_terminal_won stage → 'won'
 *   - Moving into an is_terminal_lost stage → 'lost'
 *   - Moving into a non-terminal stage (or having no stage) while the lead is
 *     currently won/lost → 'active' (reopens the deal)
 *
 * Returns null when no change is needed (already in the right status, or the
 * lead isn't closed and the destination isn't terminal).
 */
export function resolveStageOutcome(
  currentStatus: string,
  stage: StageOutcomeFlags | null,
): LeadOutcomeStatus | null {
  if (stage?.is_terminal_won) return currentStatus === 'won' ? null : 'won';
  if (stage?.is_terminal_lost) return currentStatus === 'lost' ? null : 'lost';
  if (currentStatus === 'won' || currentStatus === 'lost') return 'active';
  return null;
}
