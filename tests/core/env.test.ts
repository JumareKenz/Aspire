import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, envFlag, envNumber, envOr } from '@/lib/env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('environment access', () => {
  it('reads a set variable', () => {
    vi.stubEnv('ASPIRE_TEST_VALUE', 'hello');
    expect(env('ASPIRE_TEST_VALUE')).toBe('hello');
  });

  it('treats an unset variable as absent', () => {
    expect(env('ASPIRE_DEFINITELY_UNSET')).toBeUndefined();
  });

  it('treats a blank variable as absent', () => {
    // A deployment platform stores a declared-but-empty variable as ''. Because
    // '' is not undefined, `?? fallback` would return '' and the fallback would
    // never fire — which is how an empty seed password becomes the password.
    vi.stubEnv('ASPIRE_TEST_VALUE', '');
    expect(env('ASPIRE_TEST_VALUE')).toBeUndefined();
    expect(envOr('ASPIRE_TEST_VALUE', 'fallback')).toBe('fallback');
  });

  it('treats a whitespace-only variable as absent', () => {
    vi.stubEnv('ASPIRE_TEST_VALUE', '   ');
    expect(env('ASPIRE_TEST_VALUE')).toBeUndefined();
  });

  it('trims surrounding whitespace, which a pasted value often carries', () => {
    vi.stubEnv('ASPIRE_TEST_VALUE', '  padded  ');
    expect(env('ASPIRE_TEST_VALUE')).toBe('padded');
  });

  it('falls back for numbers that are absent, blank or unparsable', () => {
    expect(envNumber('ASPIRE_DEFINITELY_UNSET', 7)).toBe(7);
    vi.stubEnv('ASPIRE_TEST_NUMBER', '');
    expect(envNumber('ASPIRE_TEST_NUMBER', 7)).toBe(7);
    vi.stubEnv('ASPIRE_TEST_NUMBER', 'not-a-number');
    expect(envNumber('ASPIRE_TEST_NUMBER', 7)).toBe(7);
    vi.stubEnv('ASPIRE_TEST_NUMBER', '42');
    expect(envNumber('ASPIRE_TEST_NUMBER', 7)).toBe(42);
  });

  it('is true only for an explicit "true"', () => {
    expect(envFlag('ASPIRE_DEFINITELY_UNSET')).toBe(false);
    for (const value of ['', 'false', '1', 'yes', 'TRUE']) {
      vi.stubEnv('ASPIRE_TEST_FLAG', value);
      expect(envFlag('ASPIRE_TEST_FLAG')).toBe(false);
    }
    vi.stubEnv('ASPIRE_TEST_FLAG', 'true');
    expect(envFlag('ASPIRE_TEST_FLAG')).toBe(true);
  });
});
