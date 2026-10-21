import { pool } from '../../shared/utils/db';

export async function findLeadTags(assignedTo: string | null): Promise<string[]> {
  const result = await pool.query<{ tag: string }>(
    `SELECT DISTINCT tag FROM leads CROSS JOIN LATERAL unnest(tags) AS tag
     WHERE deleted_at IS NULL AND btrim(tag) <> ''
       AND ($1::uuid IS NULL OR assigned_to = $1::uuid)
     ORDER BY tag`,
    [assignedTo],
  );
  return result.rows.map((row) => row.tag);
}
