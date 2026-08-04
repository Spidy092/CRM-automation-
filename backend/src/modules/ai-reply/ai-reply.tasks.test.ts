import {
  buildReplyTaskSpec,
  buildPendingReplyTaskSpec,
  resolveDueAt,
  PENDING_REPLY_TASK_TITLE,
} from './ai-reply.tasks';
import type { IntentClass } from './ai-reply.types';

describe('buildReplyTaskSpec', () => {
  it('turns a pricing question into a quotation task named after the lead', () => {
    const spec = buildReplyTaskSpec('pricing_question', 'price', 'Beth Direct');

    expect(spec).toEqual({
      type: 'follow_up',
      title: 'Beth Direct replied — send quotation',
      dueInHours: 2,
    });
  });

  it('returns null for opt_out so no follow-up work is created', () => {
    expect(buildReplyTaskSpec('opt_out', 'unsubscribe', 'Beth Direct')).toBeNull();
    expect(buildReplyTaskSpec('opt_out', null, 'Beth Direct')).toBeNull();
  });

  it('maps a meeting request to meeting_prep with the tightest due window', () => {
    const spec = buildReplyTaskSpec('meeting_request', 'high', 'Acme Ltd');

    expect(spec?.type).toBe('meeting_prep');
    expect(spec?.dueInHours).toBe(1);
  });

  it('maps a wrong contact to a decision-maker hunt, not a follow_up', () => {
    const spec = buildReplyTaskSpec('wrong_contact', null, 'Acme Ltd');

    expect(spec?.type).toBe('other');
    expect(spec?.title).toContain('find the decision maker');
  });

  it('sharpens the objection title using the subtype', () => {
    expect(buildReplyTaskSpec('objection', 'price', 'Acme')?.title).toBe(
      'Acme pushed back on price — respond',
    );
    expect(buildReplyTaskSpec('objection', 'competitor', 'Acme')?.title).toBe(
      'Acme mentioned a competitor — respond',
    );
  });

  it('falls back to the generic objection title for an unmapped subtype', () => {
    expect(buildReplyTaskSpec('objection', 'medium', 'Acme')?.title).toBe(
      'Acme raised an objection — respond',
    );
    expect(buildReplyTaskSpec('objection', null, 'Acme')?.title).toBe(
      'Acme raised an objection — respond',
    );
  });

  it('orders due windows by urgency across intents', () => {
    const hours = (intent: IntentClass): number =>
      buildReplyTaskSpec(intent, null, 'Lead')?.dueInHours ?? -1;

    expect(hours('meeting_request')).toBeLessThan(hours('pricing_question'));
    expect(hours('pricing_question')).toBeLessThan(hours('objection'));
    expect(hours('objection')).toBeLessThan(hours('neutral'));
    expect(hours('neutral')).toBeLessThan(hours('wrong_contact'));
    expect(hours('wrong_contact')).toBeLessThan(hours('not_now'));
  });

  it('produces a task for every non-opt_out intent class', () => {
    const intents: IntentClass[] = [
      'interested',
      'objection',
      'not_now',
      'meeting_request',
      'pricing_question',
      'wrong_contact',
      'neutral',
    ];

    for (const intent of intents) {
      const spec = buildReplyTaskSpec(intent, null, 'Acme');
      expect(spec).not.toBeNull();
      expect(spec?.title).toContain('Acme');
      expect(['phone_call', 'follow_up', 'meeting_prep', 'other']).toContain(spec?.type);
    }
  });

  it('substitutes a placeholder when the lead name is blank', () => {
    expect(buildReplyTaskSpec('interested', null, '   ')?.title).toBe('Lead is interested — follow up');
  });

  it('truncates titles to the varchar(255) column limit', () => {
    const spec = buildReplyTaskSpec('interested', null, 'X'.repeat(400));

    expect(spec?.title.length).toBe(255);
    expect(spec?.title.endsWith('...')).toBe(true);
  });
});

describe('buildPendingReplyTaskSpec', () => {
  it('is due immediately so an unclassified reply surfaces at the top', () => {
    const spec = buildPendingReplyTaskSpec();

    expect(spec.title).toBe(PENDING_REPLY_TASK_TITLE);
    expect(spec.type).toBe('follow_up');
    expect(spec.dueInHours).toBe(0);
  });
});

describe('resolveDueAt', () => {
  it('offsets the due date by the spec window', () => {
    const now = new Date('2026-07-31T10:00:00.000Z');

    expect(resolveDueAt({ type: 'follow_up', title: 't', dueInHours: 2 }, now)).toBe(
      '2026-07-31T12:00:00.000Z',
    );
  });

  it('returns now for a zero-hour placeholder', () => {
    const now = new Date('2026-07-31T10:00:00.000Z');

    expect(resolveDueAt(buildPendingReplyTaskSpec(), now)).toBe('2026-07-31T10:00:00.000Z');
  });
});
