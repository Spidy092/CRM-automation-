import { AppError } from '../middleware/errorHandler';
import { isAppError, isNotFound, isConflict, isValidationError, isUnauthorized, isForbidden } from './errors';

describe('error classifiers', () => {
  describe('isAppError', () => {
    it('returns true for an AppError instance', () => {
      expect(isAppError(new AppError('boom', 400))).toBe(true);
    });

    it('returns true for a duck-typed object (survives ts-node-dev reloads)', () => {
      const fake = { isAppError: true, statusCode: 404, message: 'not found' };
      expect(isAppError(fake)).toBe(true);
    });

    it('returns false for plain Error', () => {
      expect(isAppError(new Error('boom'))).toBe(false);
    });

    it('returns false for null, undefined, primitives', () => {
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError('boom')).toBe(false);
      expect(isAppError(42)).toBe(false);
    });

    it('returns false for duck-typed object missing isAppError flag', () => {
      expect(isAppError({ statusCode: 404 })).toBe(false);
    });

    it('returns false for duck-typed object missing statusCode', () => {
      expect(isAppError({ isAppError: true })).toBe(false);
    });
  });

  describe('isNotFound', () => {
    it('returns true for AppError with 404', () => {
      expect(isNotFound(new AppError('missing', 404))).toBe(true);
    });

    it('returns false for AppError with other status codes', () => {
      expect(isNotFound(new AppError('forbidden', 403))).toBe(false);
      expect(isNotFound(new AppError('bad', 400))).toBe(false);
      expect(isNotFound(new AppError('oops', 500))).toBe(false);
    });

    it('returns false for non-AppError errors', () => {
      expect(isNotFound(new Error('not found'))).toBe(false);
      expect(isNotFound({ statusCode: 404 })).toBe(false);
    });
  });

  describe('other status helpers', () => {
    it('isConflict matches 409', () => {
      expect(isConflict(new AppError('dup', 409))).toBe(true);
      expect(isConflict(new AppError('not dup', 404))).toBe(false);
    });

    it('isValidationError matches 400', () => {
      expect(isValidationError(new AppError('bad input', 400))).toBe(true);
      expect(isValidationError(new AppError('not bad', 422))).toBe(false);
    });

    it('isUnauthorized matches 401', () => {
      expect(isUnauthorized(new AppError('no auth', 401))).toBe(true);
    });

    it('isForbidden matches 403', () => {
      expect(isForbidden(new AppError('forbidden', 403))).toBe(true);
    });
  });
});
