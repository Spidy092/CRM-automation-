import {
  manualAssignmentSchema,
  overrideAssignmentSchema,
  updateAssignmentConfigSchema,
} from '../assignments.schema';

describe('Assignments Schema Validation', () => {
  describe('manualAssignmentSchema', () => {
    it('should validate valid assignment input', () => {
      const input = {
        lead_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const result = manualAssignmentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid lead UUID', () => {
      const input = {
        lead_id: 'not-a-uuid',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const result = manualAssignmentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid user UUID', () => {
      const input = {
        lead_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: 'not-a-uuid',
      };

      const result = manualAssignmentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('overrideAssignmentSchema', () => {
    it('should validate valid override input', () => {
      const input = {
        lead_id: '123e4567-e89b-12d3-a456-426614174000',
        new_user_id: '123e4567-e89b-12d3-a456-426614174001',
        reason: 'User requested reassignment',
      };

      const result = overrideAssignmentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty reason', () => {
      const input = {
        lead_id: '123e4567-e89b-12d3-a456-426614174000',
        new_user_id: '123e4567-e89b-12d3-a456-426614174001',
        reason: '',
      };

      const result = overrideAssignmentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject reason longer than 500 chars', () => {
      const input = {
        lead_id: '123e4567-e89b-12d3-a456-426614174000',
        new_user_id: '123e4567-e89b-12d3-a456-426614174001',
        reason: 'a'.repeat(501),
      };

      const result = overrideAssignmentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('updateAssignmentConfigSchema', () => {
    it('should validate partial config update', () => {
      const input = {
        is_enabled: true,
        threshold_score: 80,
        eligible_roles: ['sales', 'manager'],
      };

      const result = updateAssignmentConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept empty update', () => {
      const input = {};
      const result = updateAssignmentConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject threshold_score out of range', () => {
      const input = { threshold_score: 101 };
      const result = updateAssignmentConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject negative threshold_score', () => {
      const input = { threshold_score: -1 };
      const result = updateAssignmentConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
