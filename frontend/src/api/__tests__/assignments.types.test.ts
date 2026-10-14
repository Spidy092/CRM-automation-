import { describe, expect, it } from 'vitest';
import type { AssignmentConfig, EligibleUser, LeadAssignment } from '../assignments';

const backendEligibleUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Sales Rep',
  email: 'sales@example.com',
  role: 'sales',
  is_available: true,
  last_assigned_at: null,
  assignment_count: 2,
} satisfies EligibleUser;

const backendAssignment = {
  id: '22222222-2222-4222-8222-222222222222',
  lead_id: '33333333-3333-4333-8333-333333333333',
  assigned_to: backendEligibleUser.id,
  assigned_by: null,
  assignment_type: 'round_robin',
  created_at: '2026-10-10T00:00:00.000Z',
} satisfies LeadAssignment;

const backendConfig = {
  id: '44444444-4444-4444-8444-444444444444',
  is_enabled: true,
  threshold_score: 60,
  eligible_roles: ['sales', 'manager'],
  updated_at: '2026-10-10T00:00:00.000Z',
} satisfies AssignmentConfig;

describe('assignment API response types', () => {
  it('accepts live-shaped backend assignment, config, and eligible-user payloads', () => {
    expect(backendEligibleUser.name).toBe('Sales Rep');
    expect(backendAssignment.assignment_type).toBe('round_robin');
    expect(backendConfig.eligible_roles).toEqual(['sales', 'manager']);
  });
});
