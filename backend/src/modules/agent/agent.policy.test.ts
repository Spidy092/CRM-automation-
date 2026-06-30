import { evaluateAgentPolicy } from './agent.policy';
import type { AgentActor } from './agent.types';

const admin: AgentActor = { id: 'user-1', role: 'admin' };
const viewer: AgentActor = { id: 'viewer-1', role: 'viewer' };

describe('evaluateAgentPolicy', () => {
  it('allows read actions for viewers', () => {
    expect(
      evaluateAgentPolicy({
        actionName: 'lead.list',
        riskTier: 'read',
        actor: viewer,
        source: 'chat',
      }),
    ).toEqual({ outcome: 'execute_now', reason: 'Read or compliance-critical action' });
  });

  it('rejects writes for disallowed roles', () => {
    expect(
      evaluateAgentPolicy({
        actionName: 'lead.pause',
        riskTier: 'sensitive_write',
        actor: viewer,
        source: 'chat',
      }).outcome,
    ).toBe('reject');
  });

  it('requires approval for chat writes', () => {
    expect(
      evaluateAgentPolicy({
        actionName: 'campaign.pause',
        riskTier: 'customer_facing_write',
        actor: admin,
        source: 'chat',
      }),
    ).toEqual({
      outcome: 'require_approval',
      reason: 'Chat write actions require explicit approval',
      assignTo: 'user-1',
    });
  });

  it('allows autopilot customer-facing writes above threshold', () => {
    expect(
      evaluateAgentPolicy({
        actionName: 'outreach.send_manual',
        riskTier: 'customer_facing_write',
        actor: admin,
        source: 'event',
        autonomyLevel: 'autopilot',
        aiMinConfidence: 70,
        confidence: 82,
      }),
    ).toEqual({ outcome: 'execute_now', reason: 'Autopilot confidence threshold met' });
  });
});
