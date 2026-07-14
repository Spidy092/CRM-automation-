import { pool } from '../../shared/utils/db';
import { UserRole } from '../../shared/types';
import { MemberMetrics, TeamMetricsFilters } from './teamMetrics.types';

interface TeamMetricsDbRow {
  user_id: string;
  name: string;
  assigned_count: string;
  contacted_count: string;
  contacted_pct: string | null;
  avg_response_time: string | null;
  total_activities: string;
}

function getUserWhere(role: UserRole, actorId: string): { clause: string; params: unknown[] } {
  const baseRoleFilter = "u.role IN ('admin', 'manager', 'sales', 'marketing')";
  if (role === 'sales') {
    return { clause: `${baseRoleFilter} AND u.id = $1`, params: [actorId] };
  }
  return { clause: baseRoleFilter, params: [] };
}

export async function findTeamMetrics(
  filters: TeamMetricsFilters,
  actorId: string,
  actorRole: UserRole,
): Promise<MemberMetrics[]> {
  const { clause: userWhere, params: userParams } = getUserWhere(actorRole, actorId);

  const params: unknown[] = [...userParams, filters.from, filters.to];
  const fromIdx = userParams.length + 1;
  const toIdx = userParams.length + 2;

  let stageClause = '';
  if (filters.stage) {
    params.push(filters.stage);
    stageClause = ` AND l.pipeline_stage_id = $${params.length}`;
  }

  const leadFilter = `l.created_at BETWEEN $${fromIdx} AND $${toIdx}${stageClause}`;
  const contactedFilter = `l.first_contacted_at IS NOT NULL AND ${leadFilter}`;
  const activityFilter = `a.created_at BETWEEN $${fromIdx} AND $${toIdx}`;

  const sql = `
    SELECT
      u.id as user_id,
      u.name,
      COUNT(DISTINCT l.id) FILTER (WHERE ${leadFilter}) as assigned_count,
      COUNT(DISTINCT l.id) FILTER (WHERE ${contactedFilter}) as contacted_count,
      ROUND(
        COUNT(DISTINCT l.id) FILTER (WHERE ${contactedFilter}) * 100.0
        / NULLIF(COUNT(DISTINCT l.id) FILTER (WHERE ${leadFilter}), 0),
        2
      ) as contacted_pct,
      AVG(EXTRACT(EPOCH FROM (l.first_contacted_at - l.created_at)))
        FILTER (WHERE ${contactedFilter}) as avg_response_time,
      COUNT(DISTINCT a.id) FILTER (WHERE ${activityFilter}) as total_activities
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    LEFT JOIN activities a ON a.user_id = u.id
    WHERE ${userWhere}
    GROUP BY u.id, u.name
    ORDER BY u.name
  `;

  const result = await pool.query<TeamMetricsDbRow>(sql, params);

  return result.rows.map((row) => ({
    user_id: row.user_id,
    name: row.name,
    assigned_count: parseInt(row.assigned_count, 10),
    contacted_count: parseInt(row.contacted_count, 10),
    contacted_pct: row.contacted_pct === null ? null : parseFloat(row.contacted_pct),
    avg_response_time: row.avg_response_time === null ? null : parseFloat(row.avg_response_time),
    total_activities: parseInt(row.total_activities, 10),
  }));
}
