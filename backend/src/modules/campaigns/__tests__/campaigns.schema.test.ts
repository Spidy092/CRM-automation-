import { createCampaignSchema, updateCampaignSchema, addLeadsSchema } from '../campaigns.schema';

describe('Campaigns Schema Validation', () => {
  describe('createCampaignSchema', () => {
    it('should validate a valid campaign input', () => {
      const input = {
        name: 'Q1 Restaurant Outreach',
        tone: 'professional',
        target_industries: ['restaurants', 'retail'],
        target_countries: ['US', 'UK'],
      };

      const result = createCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Q1 Restaurant Outreach');
        expect(result.data.tone).toBe('professional');
        expect(result.data.target_industries).toEqual(['restaurants', 'retail']);
      }
    });

    it('should apply default values', () => {
      const input = { name: 'Test Campaign' };
      const result = createCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tone).toBe('professional');
        expect(result.data.target_industries).toEqual([]);
        expect(result.data.target_countries).toEqual([]);
      }
    });

    it('should reject invalid tone', () => {
      const input = {
        name: 'Test Campaign',
        tone: 'invalid_tone',
      };

      const result = createCampaignSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const input = { name: '' };
      const result = createCampaignSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should validate optional UUID fields', () => {
      const input = {
        name: 'Test Campaign',
        sequence_id: '123e4567-e89b-12d3-a456-426614174000',
        pipeline_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const result = createCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for sequence_id', () => {
      const input = {
        name: 'Test Campaign',
        sequence_id: 'not-a-uuid',
      };

      const result = createCampaignSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('updateCampaignSchema', () => {
    it('should validate partial update', () => {
      const input = { name: 'Updated Campaign' };
      const result = updateCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept empty update', () => {
      const input = {};
      const result = updateCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate tone enum', () => {
      const input = { tone: 'formal' };
      const result = updateCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('addLeadsSchema', () => {
    it('should validate array of lead UUIDs', () => {
      const input = {
        lead_ids: [
          '123e4567-e89b-12d3-a456-426614174000',
          '123e4567-e89b-12d3-a456-426614174001',
        ],
      };

      const result = addLeadsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty array', () => {
      const input = { lead_ids: [] };
      const result = addLeadsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUIDs', () => {
      const input = { lead_ids: ['not-a-uuid'] };
      const result = addLeadsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
