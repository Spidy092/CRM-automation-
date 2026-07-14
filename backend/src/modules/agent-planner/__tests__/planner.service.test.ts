jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import OpenAI from 'openai';
import { createPlanFromGoal } from '../planner.service';
import { findPlanByIdempotencyKey, createPlan, createPlanStep, findPlanStepsByPlan } from '../plan.repository';
import { getAiConfig } from '../../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../../ai-intelligence/ai-intelligence.repository';

jest.mock('openai');
jest.mock('../plan.repository');
jest.mock('../../ai-settings/ai-settings.service');
jest.mock('../../ai-intelligence/ai-intelligence.repository');

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
let openAiCreateMock = jest.fn();
(MockedOpenAI as any).mockImplementation(() => ({
  chat: {
    completions: {
      create: openAiCreateMock,
    },
  },
}));
const mockedFindPlanByIdempotencyKey = findPlanByIdempotencyKey as jest.MockedFunction<typeof findPlanByIdempotencyKey>;
const mockedCreatePlan = createPlan as jest.MockedFunction<typeof createPlan>;
const mockedCreatePlanStep = createPlanStep as jest.MockedFunction<typeof createPlanStep>;
const mockedFindPlanStepsByPlan = findPlanStepsByPlan as jest.MockedFunction<typeof findPlanStepsByPlan>;
const mockedGetAiConfig = getAiConfig as jest.MockedFunction<typeof getAiConfig>;
const mockedInsertDecisionLog = insertDecisionLog as jest.MockedFunction<typeof insertDecisionLog>;

const baseActor = { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetAiConfig.mockResolvedValue({
    apiKey: 'test-key',
    baseUrl: null,
    model: 'gpt-4o-mini',
    maxTokens: 2000,
    temperature: 0.2,
    systemPromptOverride: null,
    cacheTtlSeconds: 3600,
  });
  mockedInsertDecisionLog.mockResolvedValue({} as any);
});

describe('planner.service.createPlanFromGoal', () => {
  it('returns an existing plan on idempotency hit', async () => {
    const existingPlan = {
      id: 'plan-existing',
      goal: 'x',
      status: 'proposed',
      source: 'chat',
      idempotency_key: 'plan:existing',
    } as any;
    mockedFindPlanByIdempotencyKey.mockResolvedValue(existingPlan);
    mockedFindPlanStepsByPlan.mockResolvedValue([]);

    const result = await createPlanFromGoal({
      goal: 'x',
      actor: baseActor as any,
      autonomyLevel: 'supervised',
      source: 'chat',
      sourceMessage: null,
    });

    expect(result.plan.goal).toBe('x');
    expect(openAiCreateMock).not.toHaveBeenCalled();
  });

  it('calls OpenAI structured output and persists a plan', async () => {
    mockedFindPlanByIdempotencyKey.mockResolvedValue(null);

    const mockCompletion = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              goal: 'get leads',
              steps: [
                {
                  step_index: 0,
                  action_name: 'lead.list',
                  action_args: { limit: 5 },
                  risk_tier: 'read',
                  depends_on: [],
                  rationale: 'fetch leads',
                },
              ],
            }),
          },
        },
      ],
    };
    openAiCreateMock.mockResolvedValue(mockCompletion as any);

    const createdPlan = {
      id: 'plan-new',
      goal: 'get leads',
      status: 'proposed',
      source: 'chat',
      idempotency_key: 'plan:...',
    } as any;
    mockedCreatePlan.mockResolvedValue(createdPlan);
    mockedCreatePlanStep.mockResolvedValue({ step_index: 0 } as any);

    const result = await createPlanFromGoal({
      goal: 'get leads',
      actor: baseActor as any,
      autonomyLevel: 'supervised',
      source: 'chat',
      sourceMessage: 'get leads please',
    });

    expect(result.steps).toHaveLength(1);
    expect(result.plan.status).toBe('proposed');
    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({ type: 'json_object' }),
      }),
    );
  });

  it('throws PlannerError(invalid_plan) when LLM output fails validation', async () => {
    mockedFindPlanByIdempotencyKey.mockResolvedValue(null);

    const mockCompletion = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              goal: 'x',
              steps: [{ step_index: 0, action_name: 'not.a.real.action' }],
            }),
          },
        },
      ],
    };
    openAiCreateMock.mockResolvedValue(mockCompletion as any);

    await expect(
      createPlanFromGoal({
        goal: 'x',
        actor: baseActor as any,
        autonomyLevel: 'supervised',
        source: 'chat',
        sourceMessage: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('throws PlannerError(unsupported_goal) when the planner declines with empty steps', async () => {
    mockedFindPlanByIdempotencyKey.mockResolvedValue(null);

    const mockCompletion = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              goal: 'create a campaign',
              steps: [],
              unsupported_reason:
                'I cannot create campaigns; I can list campaigns or launch an existing one.',
            }),
          },
        },
      ],
    };
    openAiCreateMock.mockResolvedValue(mockCompletion as any);

    await expect(
      createPlanFromGoal({
        goal: 'create a campaign',
        actor: baseActor as any,
        autonomyLevel: 'supervised',
        source: 'chat',
        sourceMessage: null,
      }),
    ).rejects.toMatchObject({
      code: 'unsupported_goal',
      message: 'I cannot create campaigns; I can list campaigns or launch an existing one.',
    });
    expect(mockedCreatePlan).not.toHaveBeenCalled();
  });

  it('retries once on malformed JSON then throws PlannerError(planner_malformed)', async () => {
    mockedFindPlanByIdempotencyKey.mockResolvedValue(null);

    openAiCreateMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'still not json' } }] });

    await expect(
      createPlanFromGoal({
        goal: 'x',
        actor: baseActor as any,
        autonomyLevel: 'supervised',
        source: 'chat',
        sourceMessage: null,
      }),
    ).rejects.toMatchObject({ code: 'planner_malformed' });
    expect(openAiCreateMock).toHaveBeenCalledTimes(2);
  });
});