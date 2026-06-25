import { pool } from '../../shared/utils/db';
import { Assignment, AssignmentConfig, RoundRobinUser } from './assignments.types';

export async function findAssignmentConfig(): Promise<AssignmentConfig | null> {
  const result = await pool.query<AssignmentConfig>('SELECT * FROM assignment_config LIMIT 1');
  return result.rows[0] || null;
}

export async function updateAssignmentConfig(
  data: { is_enabled?: boolean; threshold_score?: number; eligible_roles?: string[] },
  updatedBy: string,
): Promise<AssignmentConfig> {
  const existing = await findAssignmentConfig();

  if (!existing) {
    const result = await pool.query<AssignmentConfig>(
      `INSERT INTO assignment_config (is_enabled, threshold_score, eligible_roles, updated_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        data.is_enabled ?? true,
        data.threshold_score ?? 70,
        data.eligible_roles ?? ['sales'],
        updatedBy,
      ],
    );
    return result.rows[0];
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.is_enabled !== undefined) {
    fields.push(`is_enabled = $${paramIndex++}`);
    values.push(data.is_enabled);
  }
  if (data.threshold_score !== undefined) {
    fields.push(`threshold_score = $${paramIndex++}`);
    values.push(data.threshold_score);
  }
  if (data.eligible_roles !== undefined) {
    fields.push(`eligible_roles = $${paramIndex++}`);
    values.push(data.eligible_roles);
  }

  fields.push(`updated_by = $${paramIndex++}`);
  values.push(updatedBy);

  values.push(existing.id);
  const result = await pool.query<AssignmentConfig>(
    `UPDATE assignment_config SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function findEligibleUsers(): Promise<RoundRobinUser[]> {
  const result = await pool.query<RoundRobinUser>(
    `SELECT u.id, u.name, u.email, u.is_available,
            MAX(a.created_at) as last_assigned_at,
            COUNT(a.id) as assignment_count
     FROM users u
     LEFT JOIN assignments a ON u.id = a.assigned_to
     WHERE u.role = 'sales' AND u.is_active = TRUE AND u.is_available = TRUE
     GROUP BY u.id, u.name, u.email, u.is_available
     ORDER BY last_assigned_at ASC NULLS FIRST, assignment_count ASC`,
  );
  return result.rows;
}

export async function insertAssignment(
  leadId: string,
  assignedTo: string,
  assignedBy: string,
  assignmentType: 'round_robin' | 'manual' | 'override',
): Promise<Assignment> {
  const result = await pool.query<Assignment>(
    `INSERT INTO assignments (lead_id, assigned_to, assigned_by, assignment_type)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [leadId, assignedTo, assignedBy, assignmentType],
  );
  return result.rows[0];
}

export async function findAssignmentByLead(leadId: string): Promise<Assignment | null> {
  const result = await pool.query<Assignment>(
    'SELECT * FROM assignments WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
    [leadId],
  );
  return result.rows[0] || null;
}

export async function findAssignmentsByUser(userId: string): Promise<Assignment[]> {
  const result = await pool.query<Assignment>(
    'SELECT * FROM assignments WHERE assigned_to = $1 ORDER BY created_at DESC',
    [userId],
  );
  return result.rows;
}

export async function updateLeadAssignment(leadId: string, userId: string): Promise<void> {
  await pool.query('UPDATE leads SET assigned_to = $1 WHERE id = $2 AND deleted_at IS NULL', [
    userId,
    leadId,
  ]);
}

export async function getNextRoundRobinUser(): Promise<RoundRobinUser | null> {
  const users = await findEligibleUsers();
  return users[0] || null;
}
