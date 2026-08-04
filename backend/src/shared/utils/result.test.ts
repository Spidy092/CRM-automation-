import { ok, err, isOk, isErr } from './result';

describe('Result Utility', () => {
  it('creates ok result', () => {
    const res = ok('success');
    expect(isOk(res)).toBe(true);
    expect(isErr(res)).toBe(false);
    if (isOk(res)) {
      expect(res.value).toBe('success');
    }
  });

  it('creates err result', () => {
    const error = new Error('failed');
    const res = err(error);
    expect(isOk(res)).toBe(false);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.message).toBe('failed');
    }
  });
});
