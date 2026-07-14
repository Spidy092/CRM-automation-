jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import { buildPlannerSystemPrompt, planJsonSchema } from '../planner.prompt';
import type { AgentActor } from '../../agent/agent.types';

const actor: AgentActor = {
  id: 'user-1',
  role: 'admin',
  email: 'a@b.com',
  name: 'Admin',
  ipAddress: null,
};

describe('planner.prompt', () => {
  it('buildPlannerSystemPrompt includes actor role and autonomy level', () => {
    const prompt = buildPlannerSystemPrompt({ actor, autonomyLevel: 'supervised', today: '2026-06-30' });
    expect(prompt).toContain('admin');
    expect(prompt).toContain('supervised');
    expect(prompt).toContain('2026-06-30');
  });

  it('buildPlannerSystemPrompt includes all 21 action names', () => {
    const prompt = buildPlannerSystemPrompt({ actor, autonomyLevel: 'guarded', today: '2026-06-30' });
    for (const name of [
      'lead.list', 'lead.get', 'lead.create', 'lead.update', 'lead.pause',
      'pipeline.move_lead', 'campaign.list', 'campaign.pause', 'campaign.resume',
      'campaign.launch', 'campaign.stats', 'assignment.override', 'report.dashboard',
      'template.list', 'pipeline.list', 'sequence.list', 'scraper.list',
      'scraper.run', 'outreach.send_manual', 'ai.decision.recompute', 'ai.inbox.action',
    ]) {
      expect(prompt).toContain(name);
    }
  });

  it('buildPlannerSystemPrompt warns against compliance actions in plans', () => {
    const prompt = buildPlannerSystemPrompt({ actor, autonomyLevel: 'supervised', today: '2026-06-30' });
    expect(prompt).toMatch(/never.*plan/i);
    expect(prompt).toMatch(/compliance/i);
  });

  it('planJsonSchema uses json_object type', () => {
    expect(planJsonSchema.type).toBe('json_object');
  });
});