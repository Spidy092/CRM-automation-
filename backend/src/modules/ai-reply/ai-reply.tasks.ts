/**
 * Intent → rep task mapping.
 *
 * Turns a classified inbound reply into the concrete task a rep should see in
 * their queue. Kept pure (no I/O) so the mapping can be unit-tested directly
 * and reasoned about without mocking OpenAI or the database.
 *
 * `type` values must match the `task_type` PostgreSQL ENUM exactly:
 * 'phone_call' | 'follow_up' | 'meeting_prep' | 'other'.
 *
 * There is no priority column on `tasks`, so urgency is expressed through
 * `dueInHours` — the tasks list is ordered by `due_at ASC`, which puts the
 * hottest replies at the top of the rep's queue for free.
 */
import type { TaskType } from '../../shared/types';
import type { IntentClass, IntentSubtype } from './ai-reply.types';

export interface ReplyTaskSpec {
  type: TaskType;
  /** Rendered with the lead's business name, e.g. "Beth Direct replied — send quotation". */
  title: string;
  dueInHours: number;
}

interface IntentTaskRule {
  type: TaskType;
  /** `%s` is replaced with the lead's display name. */
  titleTemplate: string;
  dueInHours: number;
}

/**
 * `opt_out` is deliberately absent — an opt-out must never generate rep
 * follow-up work. See `buildReplyTaskSpec`.
 */
const INTENT_TASK_RULES: Record<Exclude<IntentClass, 'opt_out'>, IntentTaskRule> = {
  meeting_request: {
    type: 'meeting_prep',
    titleTemplate: '%s wants to meet — book a call',
    dueInHours: 1,
  },
  pricing_question: {
    type: 'follow_up',
    titleTemplate: '%s replied — send quotation',
    dueInHours: 2,
  },
  interested: {
    type: 'follow_up',
    titleTemplate: '%s is interested — follow up',
    dueInHours: 2,
  },
  objection: {
    type: 'follow_up',
    titleTemplate: '%s raised an objection — respond',
    dueInHours: 4,
  },
  neutral: {
    type: 'follow_up',
    titleTemplate: '%s replied — review and respond',
    dueInHours: 8,
  },
  wrong_contact: {
    type: 'other',
    titleTemplate: '%s is the wrong contact — find the decision maker',
    dueInHours: 24,
  },
  not_now: {
    type: 'follow_up',
    titleTemplate: '%s said not now — schedule a later check-in',
    dueInHours: 72,
  },
};

/** Sharpens the objection title so the rep knows what they are walking into. */
const OBJECTION_SUBTYPE_TITLES: Partial<Record<NonNullable<IntentSubtype>, string>> = {
  price: '%s pushed back on price — respond',
  timing: '%s has a timing objection — respond',
  trust: '%s raised a trust concern — respond',
  competitor: '%s mentioned a competitor — respond',
};

/** Placeholder used before classification completes, or when AI is unavailable. */
export const PENDING_REPLY_TASK_TITLE = 'Follow up on inbound reply';

export function buildPendingReplyTaskSpec(): ReplyTaskSpec {
  return {
    type: 'follow_up',
    title: PENDING_REPLY_TASK_TITLE,
    // Due immediately: an unclassified reply is the rep's problem right now.
    dueInHours: 0,
  };
}

/**
 * Returns the task a rep should act on for this reply, or `null` when the
 * reply must not create one.
 *
 * Returns `null` for `opt_out` — an opted-out lead is a hard stop, and
 * surfacing a follow-up task would invite exactly the contact we just
 * promised not to make.
 */
export function buildReplyTaskSpec(
  intentClass: IntentClass,
  intentSubtype: IntentSubtype,
  leadName: string,
): ReplyTaskSpec | null {
  if (intentClass === 'opt_out') return null;

  const rule = INTENT_TASK_RULES[intentClass];
  // Defensive: an intent class added to the type union but not to the rule map
  // should degrade to a generic review task, never crash the classifier.
  if (!rule) return { ...buildPendingReplyTaskSpec(), dueInHours: 8 };

  const template =
    (intentClass === 'objection' && intentSubtype
      ? OBJECTION_SUBTYPE_TITLES[intentSubtype]
      : undefined) ?? rule.titleTemplate;

  return {
    type: rule.type,
    title: renderTitle(template, leadName),
    dueInHours: rule.dueInHours,
  };
}

function renderTitle(template: string, leadName: string): string {
  const name = leadName.trim() || 'Lead';
  const title = template.replace('%s', name);
  // `tasks.title` is varchar(255) — truncate rather than let the insert fail.
  return title.length > 255 ? `${title.slice(0, 252)}...` : title;
}

/** Converts a spec's relative due offset into an absolute ISO timestamp. */
export function resolveDueAt(spec: ReplyTaskSpec, now: Date = new Date()): string {
  return new Date(now.getTime() + spec.dueInHours * 60 * 60 * 1000).toISOString();
}
