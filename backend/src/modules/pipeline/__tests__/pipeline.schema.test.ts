import { createPipelineSchema, updatePipelineSchema, createStageSchema, moveLeadSchema } from '../pipeline.schema';

describe('Pipeline Schema Validation', () => {
  describe('createPipelineSchema', () => {
    it('should validate a valid pipeline input', () => {
      const input = {
        name: 'Sales Pipeline',
        is_default: false,
        stages: [
          { name: 'New Lead', position: 0, is_terminal_won: false, is_terminal_lost: false },
          { name: 'Contacted', position: 1, is_terminal_won: false, is_terminal_lost: false },
          { name: 'Won', position: 2, is_terminal_won: true, is_terminal_lost: false },
        ],
      };

      const result = createPipelineSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Sales Pipeline');
        expect(result.data.stages).toHaveLength(3);
      }
    });

    it('should reject empty pipeline name', () => {
      const input = {
        name: '',
        stages: [{ name: 'Stage 1', position: 0 }],
      };

      const result = createPipelineSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject pipeline without stages', () => {
      const input = {
        name: 'Sales Pipeline',
        stages: [],
      };

      const result = createPipelineSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should apply default values', () => {
      const input = {
        name: 'Sales Pipeline',
        stages: [{ name: 'Stage 1', position: 0 }],
      };

      const result = createPipelineSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_default).toBe(false);
        expect(result.data.stages[0].is_terminal_won).toBe(false);
        expect(result.data.stages[0].is_terminal_lost).toBe(false);
      }
    });
  });

  describe('updatePipelineSchema', () => {
    it('should validate partial update', () => {
      const input = { name: 'Updated Pipeline' };
      const result = updatePipelineSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept empty update', () => {
      const input = {};
      const result = updatePipelineSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('moveLeadSchema', () => {
    it('should validate valid UUIDs', () => {
      const input = {
        lead_id: '123e4567-e89b-12d3-a456-426614174000',
        stage_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const result = moveLeadSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      const input = {
        lead_id: 'not-a-uuid',
        stage_id: 'also-not-a-uuid',
      };

      const result = moveLeadSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
