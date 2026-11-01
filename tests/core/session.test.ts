import { describe, expect, it } from 'vitest';
import { sessionIsCurrent } from '@/auth/session';

describe('sessions after a password change', () => {
  const changed = '2026-11-01T10:00:00.400Z';
  const changedSeconds = Math.floor(new Date(changed).getTime() / 1000);

  it('accepts any session when the password has never changed', () => {
    expect(sessionIsCurrent(1, null)).toBe(true);
  });

  it('refuses a session issued before the change', () => {
    expect(sessionIsCurrent(changedSeconds - 1, changed)).toBe(false);
  });

  it('accepts the session reissued by the change itself', () => {
    expect(sessionIsCurrent(changedSeconds, changed)).toBe(true);
    expect(sessionIsCurrent(changedSeconds + 60, changed)).toBe(true);
  });

  it('refuses a token with no issue time once a password has changed', () => {
    expect(sessionIsCurrent(undefined, changed)).toBe(false);
  });
});
