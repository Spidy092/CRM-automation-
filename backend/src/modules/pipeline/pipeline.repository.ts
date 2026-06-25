import { pool } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { Pipeline, PipelineStage, PipelineWithStages } from './pipeline.types';

export async function findPipelines(): Promise<Pipeline[]> {
  const result = await pool.query<Pipeline>(
    'SELECT * FROM pipelines ORDER BY is_default DESC, created_at DESC',
  );
  return result.rows;
}

export async function findPipelineById(id: string): Promise<Pipeline | null> {
  const result = await pool.query<Pipeline>('SELECT * FROM pipelines WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function findPipelineWithStages(id: string): Promise<PipelineWithStages | null> {
  const pipelineResult = await pool.query<Pipeline>('SELECT * FROM pipelines WHERE id = $1', [id]);
  if (pipelineResult.rows.length === 0) return null;

  const stagesResult = await pool.query<PipelineStage>(
    'SELECT * FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
    [id],
  );

  return {
    ...pipelineResult.rows[0],
    stages: stagesResult.rows,
  };
}

export async function insertPipeline(
  name: string,
  isDefault: boolean,
  createdBy: string,
): Promise<Pipeline> {
  const result = await pool.query<Pipeline>(
    'INSERT INTO pipelines (name, is_default, created_by) VALUES ($1, $2, $3) RETURNING *',
    [name, isDefault, createdBy],
  );
  return result.rows[0];
}

export async function updatePipeline(
  id: string,
  data: { name?: string; is_default?: boolean },
): Promise<Pipeline> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.is_default !== undefined) {
    fields.push(`is_default = $${paramIndex++}`);
    values.push(data.is_default);
  }

  values.push(id);
  const result = await pool.query<Pipeline>(
    `UPDATE pipelines SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Pipeline not found', 404);
  return row;
}

export async function deletePipeline(id: string): Promise<void> {
  await pool.query('DELETE FROM pipelines WHERE id = $1', [id]);
}

export async function insertStage(
  pipelineId: string,
  name: string,
  position: number,
  isTerminalWon: boolean,
  isTerminalLost: boolean,
): Promise<PipelineStage> {
  const result = await pool.query<PipelineStage>(
    `INSERT INTO pipeline_stages (pipeline_id, name, position, is_terminal_won, is_terminal_lost)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [pipelineId, name, position, isTerminalWon, isTerminalLost],
  );
  return result.rows[0];
}

export async function updateStage(
  id: string,
  data: { name?: string; position?: number; is_terminal_won?: boolean; is_terminal_lost?: boolean },
): Promise<PipelineStage> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.position !== undefined) {
    fields.push(`position = $${paramIndex++}`);
    values.push(data.position);
  }
  if (data.is_terminal_won !== undefined) {
    fields.push(`is_terminal_won = $${paramIndex++}`);
    values.push(data.is_terminal_won);
  }
  if (data.is_terminal_lost !== undefined) {
    fields.push(`is_terminal_lost = $${paramIndex++}`);
    values.push(data.is_terminal_lost);
  }

  values.push(id);
  const result = await pool.query<PipelineStage>(
    `UPDATE pipeline_stages SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Pipeline stage not found', 404);
  return row;
}

export async function deleteStage(id: string): Promise<void> {
  await pool.query('DELETE FROM pipeline_stages WHERE id = $1', [id]);
}

export async function findStagesByPipeline(pipelineId: string): Promise<PipelineStage[]> {
  const result = await pool.query<PipelineStage>(
    'SELECT * FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
    [pipelineId],
  );
  return result.rows;
}

export async function findStageById(id: string): Promise<PipelineStage | null> {
  const result = await pool.query<PipelineStage>('SELECT * FROM pipeline_stages WHERE id = $1', [
    id,
  ]);
  return result.rows[0] || null;
}

export async function moveLeadToStage(leadId: string, stageId: string): Promise<void> {
  await pool.query('UPDATE leads SET pipeline_stage_id = $1 WHERE id = $2', [stageId, leadId]);
}

export async function findDefaultPipeline(): Promise<Pipeline | null> {
  const result = await pool.query<Pipeline>(
    'SELECT * FROM pipelines WHERE is_default = TRUE LIMIT 1',
  );
  return result.rows[0] || null;
}
