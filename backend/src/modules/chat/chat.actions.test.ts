import { AGENT_ACTIONS } from '../agent/agent.actions';
import { buildChatTools, toolNameToActionName } from './chat.actions';

jest.mock('../agent/agent.actions', () => {
  const sampleDefinition = (
    name: string,
    description: string,
  ) => ({
    name,
    description,
    riskTier: 'read' as const,
    allowedRoles: ['admin' as const],
    schema: { parse: jest.fn() },
    entity: jest.fn(),
    execute: jest.fn(),
  });

  return {
    AGENT_ACTIONS: {
      'lead.list': sampleDefinition('lead.list', 'List leads.'),
      'lead.get': sampleDefinition('lead.get', 'Get one lead.'),
      'campaign.pause': sampleDefinition('campaign.pause', 'Pause a campaign.'),
      'report.dashboard': sampleDefinition('report.dashboard', 'Dashboard metrics.'),
    },
    getAgentActionDefinition: jest.fn(),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chat.actions — buildChatTools', () => {
  it('returns an array', () => {
    const tools = buildChatTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it('returns one tool per registered AGENT_ACTIONS entry', () => {
    const tools = buildChatTools();
    expect(tools).toHaveLength(Object.keys(AGENT_ACTIONS).length);
  });

  it('returns 4 tools when AGENT_ACTIONS has 4 entries', () => {
    const tools = buildChatTools();
    expect(tools).toHaveLength(4);
  });

  it('each tool has type === "function"', () => {
    const tools = buildChatTools();
    for (const tool of tools) {
      expect(tool.type).toBe('function');
    }
  });

  it('each tool exposes function.name, function.description, and function.parameters', () => {
    const tools = buildChatTools();
    for (const tool of tools) {
      expect(typeof tool.function.name).toBe('string');
      expect(tool.function.name.length).toBeGreaterThan(0);
      expect(typeof tool.function.description).toBe('string');
      expect((tool.function.description ?? '').length).toBeGreaterThan(0);
      expect(tool.function.parameters).toBeDefined();
      expect(typeof tool.function.parameters).toBe('object');
    }
  });

  it('each tool name uses "__" separator (not ".")', () => {
    const tools = buildChatTools();
    for (const tool of tools) {
      expect(tool.function.name).not.toContain('.');
      expect(tool.function.name.split('__')).toHaveLength(2);
    }
  });

  it('tool names map back to their source AGENT_ACTIONS names', () => {
    const tools = buildChatTools();
    const names = tools.map((t) => t.function.name).sort();
    expect(names).toEqual(['campaign__pause', 'lead__get', 'lead__list', 'report__dashboard']);
  });

  it('copies descriptions verbatim from AGENT_ACTIONS', () => {
    const tools = buildChatTools();
    const byName = new Map(tools.map((t) => [t.function.name, t.function.description]));
    expect(byName.get('lead__list')).toBe('List leads.');
    expect(byName.get('campaign__pause')).toBe('Pause a campaign.');
    expect(byName.get('report__dashboard')).toBe('Dashboard metrics.');
    expect(byName.get('lead__get')).toBe('Get one lead.');
  });

  it('attaches actionParameters for each action', () => {
    const tools = buildChatTools();
    const byName = new Map(tools.map((t) => [t.function.name, t.function.parameters]));
    expect((byName.get('lead__list') as Record<string, unknown>).type).toBe('object');
    expect((byName.get('lead__get') as Record<string, unknown>).type).toBe('object');
    expect((byName.get('campaign__pause') as Record<string, unknown>).type).toBe('object');
    expect((byName.get('report__dashboard') as Record<string, unknown>).type).toBe('object');
  });
});

describe('chat.actions — toolNameToActionName', () => {
  it('converts "lead__list" to "lead.list"', () => {
    expect(toolNameToActionName('lead__list')).toBe('lead.list');
  });

  it('converts "campaign__pause" to "campaign.pause"', () => {
    expect(toolNameToActionName('campaign__pause')).toBe('campaign.pause');
  });

  it('round-trips with buildChatTools names', () => {
    const tools = buildChatTools();
    for (const tool of tools) {
      const actionName = toolNameToActionName(tool.function.name);
      expect(actionName).toContain('.');
      expect(AGENT_ACTIONS[actionName]).toBeDefined();
    }
  });

  it('replaces only the first "__" occurrence', () => {
    // toolNameToActionName uses String.replace (no /g flag), so only first "__" -> "."
    expect(toolNameToActionName('a__b__c')).toBe('a.b__c');
  });
});
