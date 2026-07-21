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
  const baseRoleFilter = "u.role IN ('admin', 'manager', 'sales', 'marketing', 'viewer')";
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

  // Date range scopes to when the lead was assigned to this rep (the
  // relevant "team activity" event), not when the lead record itself was
  // created/imported — leads are often scraped/imported long before being
  // worked, so filtering on l.created_at made every metric read zero once a
  // lead aged past the window.
  //
  // Only assignments made via the assign/reassign/round-robin flows write a
  // row to `assignments` — leads created with an owner already set, or
  // reassigned through the generic lead update path, have no such row. Fall
  // back to l.created_at in that case so those leads aren't silently
  // excluded from every metric.
  const assignmentDate = 'COALESCE(latest_assignment.created_at, l.created_at)';
  const leadFilter = `${assignmentDate} BETWEEN $${fromIdx} AND $${toIdx}${stageClause}`;
  const contactedFilter = `l.first_contacted_at IS NOT NULL AND ${leadFilter}`;

  let activityJoin = `a.user_id = u.id AND a.created_at BETWEEN $${fromIdx} AND $${toIdx}`;
  if (filters.stage) {
    params.push(filters.stage);
    activityJoin += ` AND a.lead_id IN (SELECT la.id FROM leads la WHERE la.assigned_to = u.id AND la.pipeline_stage_id = $${params.length} AND la.deleted_at IS NULL)`;
  }

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
      COUNT(DISTINCT a.id) FILTER (WHERE ${activityJoin}) as total_activities
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id AND l.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT asg.created_at
      FROM assignments asg
      WHERE asg.lead_id = l.id AND asg.assigned_to = u.id
      ORDER BY asg.created_at DESC
      LIMIT 1
    ) latest_assignment ON TRUE
    LEFT JOIN activities a ON a.lead_id = l.id
    WHERE u.deleted_at IS NULL AND ${userWhere}
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
