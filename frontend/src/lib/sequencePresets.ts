import type { SequenceStep } from '@/api/outreach';

/**
 * Ready-made outreach sequences so a campaign never starts from a blank page.
 * Picking one creates its templates and the sequence in a single click; everything
 * stays fully editable afterwards — these are starting points, not fixed flows.
 *
 * Bodies use the same `{{merge_field}}` syntax the template editor parses
 * (see `extractVariables` in `@/lib/templateVars`).
 */

export interface PresetStep {
  channel: SequenceStep['channel'];
  /** Delay after the previous step. The first step is always 0 (send on enrolment). */
  delayHours: number;
  template: {
    /** Suffixed with the sequence name at creation time to keep template names unique. */
    name: string;
    subject: string | null;
    body: string;
  };
}

export interface SequencePreset {
  id: string;
  name: string;
  description: string;
  steps: PresetStep[];
}

export const SEQUENCE_PRESETS: SequencePreset[] = [
  {
    id: 'cold-email',
    name: 'Cold Email',
    description: 'Three touches for leads who have never heard from you — intro, proof, then a polite last check-in.',
    steps: [
      {
        channel: 'email',
        delayHours: 0,
        template: {
          name: 'Step 1 — Intro',
          subject: 'Quick question about {{company}}',
          body:
            'Hi {{first_name}},\n\n' +
            "I came across {{company}} and noticed you're doing interesting work in your space.\n\n" +
            'We help teams like yours get more out of their online presence — usually without adding headcount.\n\n' +
            'Worth a short chat this week?\n\n' +
            'Best,\n{{sender_name}}',
        },
      },
      {
        channel: 'email',
        delayHours: 72,
        template: {
          name: 'Step 2 — Proof',
          subject: 'How we helped a team like {{company}}',
          body:
            'Hi {{first_name}},\n\n' +
            'Following up on my last note with something concrete.\n\n' +
            'We recently worked with a business much like {{company}} and helped them turn more of their existing traffic into enquiries — no extra ad spend involved.\n\n' +
            'Happy to walk you through exactly what we did. Would 15 minutes work?\n\n' +
            'Best,\n{{sender_name}}',
        },
      },
      {
        channel: 'email',
        delayHours: 120,
        template: {
          name: 'Step 3 — Last check-in',
          subject: 'Should I close the loop?',
          body:
            'Hi {{first_name}},\n\n' +
            "I haven't heard back, which usually means this is not a priority right now — completely understand.\n\n" +
            "I'll stop reaching out after this one. If it becomes relevant later, just reply here and I'll pick it straight back up.\n\n" +
            'All the best,\n{{sender_name}}',
        },
      },
    ],
  },
  {
    id: 'inbound-lead',
    name: 'Inbound Lead',
    description: 'For leads who came to you — reply instantly, then offer a demo and a consultation.',
    steps: [
      {
        channel: 'email',
        delayHours: 0,
        template: {
          name: 'Step 1 — Welcome',
          subject: 'Thanks for getting in touch, {{first_name}}',
          body:
            'Hi {{first_name}},\n\n' +
            'Thanks for reaching out — got your enquiry and I am on it.\n\n' +
            "Tell me a little about what you're trying to achieve and I'll come back with something specific rather than a generic pitch.\n\n" +
            'Best,\n{{sender_name}}',
        },
      },
      {
        channel: 'email',
        delayHours: 24,
        template: {
          name: 'Step 2 — Demo offer',
          subject: 'Want to see it in action?',
          body:
            'Hi {{first_name}},\n\n' +
            'Rather than send over a long document, it is usually faster to just show you.\n\n' +
            'I can do a short walkthrough built around {{company}} specifically — about 15 minutes, no slides.\n\n' +
            'Would that be useful?\n\n' +
            'Best,\n{{sender_name}}',
        },
      },
      {
        channel: 'email',
        delayHours: 72,
        template: {
          name: 'Step 3 — Consultation invite',
          subject: 'Free consultation — your call',
          body:
            'Hi {{first_name}},\n\n' +
            'Last one from me on this.\n\n' +
            "If it's helpful, I'm happy to spend 20 minutes going through what I'd do in your position — no obligation either way.\n\n" +
            'Just reply with a time that suits and I will send an invite.\n\n' +
            'Best,\n{{sender_name}}',
        },
      },
    ],
  },
  {
    id: 're-engagement',
    name: 'Re-engagement',
    description: 'Two touches to revive leads who went quiet — a light nudge, then a clean break-up.',
    steps: [
      {
        channel: 'email',
        delayHours: 0,
        template: {
          name: 'Step 1 — Nudge',
          subject: 'Still worth revisiting, {{first_name}}?',
          body:
            'Hi {{first_name}},\n\n' +
            'We spoke a while back about {{company}} and then things went quiet — which usually just means timing.\n\n' +
            'If it is worth picking back up, I am happy to. If not, no hard feelings.\n\n' +
            'Best,\n{{sender_name}}',
        },
      },
      {
        channel: 'email',
        delayHours: 96,
        template: {
          name: 'Step 2 — Break-up',
          subject: 'Closing your file',
          body:
            'Hi {{first_name}},\n\n' +
            'I am going to close this off so I stop cluttering your inbox.\n\n' +
            'If anything changes down the line, reply to this email and I will pick it straight back up — no need to start over.\n\n' +
            'All the best,\n{{sender_name}}',
        },
      },
    ],
  },
];
