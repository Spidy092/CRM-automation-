/**
 * BullMQ transport IDs — validated against the installed BullMQ Job
 * validator (no Redis needed). The colon-joined durable execution identity
 * is rejected as a custom job ID, so publication maps it to a stable
 * permitted encoding while the full key travels in job data.
 */
import { Job } from 'bullmq';
import { buildTransportJobId } from './queue';
import { buildDedupeKey } from '../modules/campaigns/campaigns.execution.repository';

type ValidateFn = (this: unknown, job: unknown) => void;

function installedValidator(): ValidateFn {
  const proto = Job.prototype as unknown as Record<string, ValidateFn>;
  const fn = proto.validateOptions;
  if (typeof fn !== 'function') throw new Error('installed BullMQ lacks validateOptions');
  return fn;
}

function assertValidJobId(jobId: string): void {
  expect(() => installedValidator().call({ opts: { jobId } }, { data: {} })).not.toThrow();
}

function assertInvalidJobId(jobId: string): void {
  expect(() => installedValidator().call({ opts: { jobId } }, { data: {} })).toThrow(
    /Custom Id cannot contain :/,
  );
}

describe('buildTransportJobId', () => {
  it('maps execution identities to stable permitted IDs', () => {
    const dedupeKey = buildDedupeKey({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: 'snap-1',
      stepNumber: 1,
      generation: 0,
      attempt: 0,
    });
    expect(dedupeKey).toContain(':');
    assertInvalidJobId(`exec-${dedupeKey}`);

    const first = buildTransportJobId(dedupeKey);
    expect(first).not.toContain(':');
    expect(first).toMatch(/^exec-[0-9a-f]{32}$/);
    assertValidJobId(`outreach-dispatch-camp-1-lead-1-step-1-${first}`);
    assertValidJobId(`outreach-dispatch-camp-1-lead-1-step-1-${first}-deferred-12345`);
    // Stable and distinct per execution.
    expect(buildTransportJobId(dedupeKey)).toBe(first);
    expect(buildTransportJobId(`${dedupeKey}-other`)).not.toBe(first);
  });
});
