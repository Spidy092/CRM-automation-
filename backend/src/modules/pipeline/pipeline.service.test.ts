jest.mock('../../workers/queue');
jest.mock('./pipeline.repository', () => ({
  findPipelines: jest.fn(),
  findPipelineById: jest.fn(),
  findPipelineWithStages: jest.fn(),
  insertPipeline: jest.fn(),
  updatePipeline: jest.fn(),
  deletePipeline: jest.fn(),
  insertStage: jest.fn(),
  updateStage: jest.fn(),
  deleteStage: jest.fn(),
  findStagesByPipeline: jest.fn(),
  findStageById: jest.fn(),
  moveLeadToStage: jest.fn(),
  findDefaultPipeline: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../leads/leads.repository', () => ({
  findLeadById: jest.fn(),
  updateLeadOutcome: jest.fn(),
}));
jest.mock('../activities/activities.repository', () => ({
  insertActivity: jest.fn(),
}));

import { AppError } from '../../shared/middleware/errorHandler';
import { findLeadById, updateLeadOutcome } from '../leads/leads.repository';
import { insertActivity } from '../activities/activities.repository';
import {
  findPipelines,
  findPipelineById,
  findPipelineWithStages,
  insertPipeline,
  updatePipeline,
  deletePipeline,
  insertStage,
  updateStage,
  deleteStage,
  findStagesByPipeline,
  findStageById,
  moveLeadToStage,
  findDefaultPipeline,
} from './pipeline.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  createPipeline,
  createStage,
  deletePipelineById,
  deleteStageById,
  getAllPipelines,
  getDefaultPipeline,
  getPipelineById,
  getStages,
  moveLead,
  updatePipelineById,
  updateStageById,
} from './pipeline.service';

const basePipeline = {
  id: 'pipe-1',
  name: 'Default',
  is_default: true,
  created_by: 'admin-1',
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const baseStage = {
  id: 'stage-1',
  pipeline_id: 'pipe-1',
  name: 'New',
  position: 1,
  is_terminal_won: false,
  is_terminal_lost: false,
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const actor = { id: 'admin-1', role: 'admin', ipAddress: '127.0.0.1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAllPipelines', () => {
  it('delegates to the repository', async () => {
    (findPipelines as jest.Mock).mockResolvedValue([basePipeline]);
    const res = await getAllPipelines();
    expect(res).toEqual([basePipeline]);
  });
});

describe('getPipelineById', () => {
  it('returns pipeline with stages', async () => {
    (findPipelineWithStages as jest.Mock).mockResolvedValue({ ...basePipeline, stages: [baseStage] });
    const res = await getPipelineById('pipe-1');
    expect(res.stages).toHaveLength(1);
  });

  it('throws 404 when not found', async () => {
    (findPipelineWithStages as jest.Mock).mockResolvedValue(null);
    await expect(getPipelineById('missing')).rejects.toBeInstanceOf(AppError);
  });
});

describe('createPipeline', () => {
  it('inserts pipeline + each stage and audits', async () => {
    (insertPipeline as jest.Mock).mockResolvedValue(basePipeline);
    (insertStage as jest.Mock).mockResolvedValue(baseStage);
    (findPipelineWithStages as jest.Mock).mockResolvedValue({ ...basePipeline, stages: [baseStage] });

    const res = await createPipeline(
      {
        name: 'Default',
        is_default: true,
        stages: [{ name: 'New', position: 1 }],
      },
      actor,
    );

    expect(insertPipeline).toHaveBeenCalledWith('Default', true, 'admin-1');
    expect(insertStage).toHaveBeenCalledWith('pipe-1', 'New', 1, false, false);
    expect(writeAuditLog).toHaveBeenCalled();
    expect(res.id).toBe('pipe-1');
  });
});

describe('updatePipelineById', () => {
  it('updates and audits', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(basePipeline);
    (updatePipeline as jest.Mock).mockResolvedValue({ ...basePipeline, name: 'Renamed' });
    const res = await updatePipelineById('pipe-1', { name: 'Renamed' }, actor);
    expect(res.name).toBe('Renamed');
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('throws 404 when not found', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(null);
    await expect(updatePipelineById('x', { name: 'x' }, actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('deletePipelineById', () => {
  it('refuses to delete the default pipeline', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(basePipeline);
    await expect(deletePipelineById('pipe-1', actor)).rejects.toMatchObject({ statusCode: 400 });
    expect(deletePipeline).not.toHaveBeenCalled();
  });

  it('deletes and audits when not default', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue({ ...basePipeline, is_default: false });
    await deletePipelineById('pipe-1', actor);
    expect(deletePipeline).toHaveBeenCalledWith('pipe-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('getStages', () => {
  it('returns stages for a valid pipeline', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(basePipeline);
    (findStagesByPipeline as jest.Mock).mockResolvedValue([baseStage]);
    const res = await getStages('pipe-1');
    expect(res).toEqual([baseStage]);
  });

  it('throws 404 when pipeline missing', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(null);
    await expect(getStages('x')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('updateStageById', () => {
  it('updates and audits', async () => {
    (findStageById as jest.Mock).mockResolvedValue(baseStage);
    (updateStage as jest.Mock).mockResolvedValue({ ...baseStage, name: 'Renamed' });
    const res = await updateStageById('stage-1', { name: 'Renamed' }, actor);
    expect(res.name).toBe('Renamed');
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('throws 404 when stage missing', async () => {
    (findStageById as jest.Mock).mockResolvedValue(null);
    await expect(updateStageById('x', { name: 'x' }, actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('moveLead', () => {
  const baseLead = { id: 'lead-1', assigned_to: null, status: 'active' };

  beforeEach(() => {
    (findLeadById as jest.Mock).mockReset().mockResolvedValue(baseLead);
    (updateLeadOutcome as jest.Mock).mockReset();
    (insertActivity as jest.Mock).mockReset();
  });

  it('throws 404 when stage missing', async () => {
    (findStageById as jest.Mock).mockResolvedValue(null);
    await expect(moveLead('lead-1', 'x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when lead missing', async () => {
    (findStageById as jest.Mock).mockResolvedValue(baseStage);
    (findLeadById as jest.Mock).mockResolvedValue(null);
    await expect(moveLead('lead-x', 'stage-1', actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(moveLeadToStage).not.toHaveBeenCalled();
  });

  it('moves and audits on success', async () => {
    (findStageById as jest.Mock).mockResolvedValue(baseStage);
    await moveLead('lead-1', 'stage-1', actor);
    expect(moveLeadToStage).toHaveBeenCalledWith('lead-1', 'stage-1');
    expect(writeAuditLog).toHaveBeenCalled();
    expect(updateLeadOutcome).not.toHaveBeenCalled();
  });

  it('marks the lead won when moved into a terminal-won stage', async () => {
    (findStageById as jest.Mock).mockResolvedValue({ ...baseStage, is_terminal_won: true });
    await moveLead('lead-1', 'stage-1', actor);
    expect(updateLeadOutcome).toHaveBeenCalledWith('lead-1', 'won');
    expect(insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        type: 'status_change',
        metadata: expect.objectContaining({ field: 'status', to: 'won' }),
      }),
    );
  });

  it('marks the lead lost when moved into a terminal-lost stage', async () => {
    (findStageById as jest.Mock).mockResolvedValue({ ...baseStage, is_terminal_lost: true });
    await moveLead('lead-1', 'stage-1', actor);
    expect(updateLeadOutcome).toHaveBeenCalledWith('lead-1', 'lost');
  });

  it('rejects moving a won lead back into a non-terminal stage (H1)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseLead, status: 'won' });
    (findStageById as jest.Mock).mockResolvedValue(baseStage);
    await expect(moveLead('lead-1', 'stage-1', actor)).rejects.toThrow(
      'Cannot move a closed (won/lost/opted_out) lead to an active stage',
    );
  });

  it('rejects moving a lead to a stage in a different pipeline (H3)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseLead, pipeline_stage_id: 'stage-old' });
    (findStageById as jest.Mock).mockImplementation(async (id: string) => {
      if (id === 'stage-old') return { ...baseStage, id: 'stage-old', pipeline_id: 'pipe-old' };
      if (id === 'stage-new') return { ...baseStage, id: 'stage-new', pipeline_id: 'pipe-new' };
      return null;
    });
    await expect(moveLead('lead-1', 'stage-new', actor)).rejects.toThrow(
      'Target stage belongs to a different pipeline than the lead’s current pipeline',
    );
  });
});

describe('getDefaultPipeline', () => {
  it('delegates to the repository', async () => {
    (findDefaultPipeline as jest.Mock).mockResolvedValue(basePipeline);
    await expect(getDefaultPipeline()).resolves.toBe(basePipeline);
  });
});

describe('createStage', () => {
  it('throws 404 when pipeline missing', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(null);
    await expect(
      createStage('pipe-x', { name: 'New', position: 1 }, actor),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(insertStage).not.toHaveBeenCalled();
  });

  it('inserts stage and audits on success', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(basePipeline);
    (insertStage as jest.Mock).mockResolvedValue({ ...baseStage, name: 'Contacted' });
    const res = await createStage(
      'pipe-1',
      { name: 'Contacted', position: 2, is_terminal_won: true },
      actor,
    );
    expect(res.name).toBe('Contacted');
    expect(insertStage).toHaveBeenCalledWith('pipe-1', 'Contacted', 2, true, false);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pipeline_stage.created' }),
    );
  });

  it('defaults terminal flags to false', async () => {
    (findPipelineById as jest.Mock).mockResolvedValue(basePipeline);
    (insertStage as jest.Mock).mockResolvedValue(baseStage);
    await createStage('pipe-1', { name: 'New', position: 1 }, actor);
    expect(insertStage).toHaveBeenCalledWith('pipe-1', 'New', 1, false, false);
  });
});

describe('deleteStageById', () => {
  it('throws 404 when stage missing', async () => {
    (findStageById as jest.Mock).mockResolvedValue(null);
    await expect(deleteStageById('stage-x', actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(deleteStage).not.toHaveBeenCalled();
  });

  it('deletes and audits on success', async () => {
    (findStageById as jest.Mock).mockResolvedValue(baseStage);
    await deleteStageById('stage-1', actor);
    expect(deleteStage).toHaveBeenCalledWith('stage-1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pipeline_stage.deleted' }),
    );
  });
});

describe('moveLead sales-role ownership check', () => {
  const salesActor = { id: 'sales-1', role: 'sales', ipAddress: '127.0.0.1' };

  beforeEach(() => {
    (findStageById as jest.Mock).mockResolvedValue(baseStage);
    (findLeadById as jest.Mock).mockReset();
    (moveLeadToStage as jest.Mock).mockReset();
  });

  it('throws 403 when sales actor does not own the lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({
      id: 'lead-1',
      assigned_to: 'sales-2',
      status: 'active',
    });
    await expect(moveLead('lead-1', 'stage-1', salesActor)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(moveLeadToStage).not.toHaveBeenCalled();
  });

  it('throws 404 when sales actor queries a missing lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(null);
    await expect(moveLead('lead-x', 'stage-1', salesActor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('allows sales actor to move their own lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({
      id: 'lead-1',
      assigned_to: 'sales-1',
      status: 'active',
    });
    await moveLead('lead-1', 'stage-1', salesActor);
    expect(moveLeadToStage).toHaveBeenCalledWith('lead-1', 'stage-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('admin can move any lead without an ownership check', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({
      id: 'lead-1',
      assigned_to: 'sales-2',
      status: 'active',
    });
    await moveLead('lead-1', 'stage-1', actor);
    expect(moveLeadToStage).toHaveBeenCalledWith('lead-1', 'stage-1');
  });
});
