import {
  createScoringRuleSchema,
  updateScoringRuleSchema,
  updateScoringConfigSchema,
} from '../scoring.schema';

describe('Scoring Schema Validation', () => {
  describe('createScoringRuleSchema', () => {
    it('should validate valid scoring rule input', () => {
      const input = {
        factor: 'has_website',
        weight: 20,
        condition: {},
        score_value: 15,
        is_active: true,
      };

      const result = createScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.factor).toBe('has_website');
        expect(result.data.weight).toBe(20);
        expect(result.data.score_value).toBe(15);
      }
    });

    it('should apply default is_active value', () => {
      const input = {
        factor: 'has_email',
        weight: 10,
        condition: {},
        score_value: 10,
      };

      const result = createScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_active).toBe(true);
      }
    });

    it('should reject empty factor', () => {
      const input = {
        factor: '',
        weight: 10,
        condition: {},
        score_value: 10,
      };

      const result = createScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject weight over 100', () => {
      const input = {
        factor: 'test',
        weight: 101,
        condition: {},
        score_value: 10,
      };

      const result = createScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject negative score_value', () => {
      const input = {
        factor: 'test',
        weight: 10,
        condition: {},
        score_value: -1,
      };

      const result = createScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should validate with complex condition', () => {
      const input = {
        factor: 'industry_match',
        weight: 30,
        condition: { industries: ['restaurants', 'retail'] },
        score_value: 25,
      };

      const result = createScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('updateScoringRuleSchema', () => {
    it('should validate partial update', () => {
      const input = { factor: 'updated_factor' };
      const result = updateScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept empty update', () => {
      const input = {};
      const result = updateScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate weight range', () => {
      const input = { weight: 50 };
      const result = updateScoringRuleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('updateScoringConfigSchema', () => {
    it('should validate valid config update', () => {
      const input = {
        hot_min_score: 80,
        warm_min_score: 50,
        assignment_threshold: 75,
      };

      const result = updateScoringConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept partial config update', () => {
      const input = { hot_min_score: 90 };
      const result = updateScoringConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject score over 100', () => {
      const input = { hot_min_score: 101 };
      const result = updateScoringConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject negative score', () => {
      const input = { warm_min_score: -1 };
      const result = updateScoringConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
