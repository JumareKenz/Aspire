// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { UserManager } = await import('@/app/(app)/admin/users/UserManager');

afterEach(cleanup);

describe('Drawer focus', () => {
  // Regression: the drawer's open effect depended on onClose, which callers
  // recreate every render, so each keystroke re-ran it and its cleanup sent
  // focus back to the "Add user" button after one character.
  it('keeps focus in a field while typing into the Add user form', async () => {
    render(<UserManager users={[]} scopeChoices={[]} currentUserId="me" canManage />);
    const trigger = screen.getByRole('button', { name: 'Add user' });
    trigger.focus();
    fireEvent.click(trigger);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    const name = screen.getByLabelText('Full name');
    name.focus();
    for (const value of ['A', 'Am', 'Ami', 'Amin', 'Amina']) {
      fireEvent.change(name, { target: { value } });
      expect(document.activeElement).toBe(name);
    }
    expect(name).toHaveProperty('value', 'Amina');

    const email = screen.getByLabelText('Email address');
    email.focus();
    fireEvent.change(email, { target: { value: 'a' } });
    fireEvent.change(email, { target: { value: 'am' } });
    expect(document.activeElement).toBe(email);
  });

  it('still closes on Escape and returns focus to the trigger', async () => {
    render(<UserManager users={[]} scopeChoices={[]} currentUserId="me" canManage />);
    const trigger = screen.getByRole('button', { name: 'Add user' });
    trigger.focus();
    fireEvent.click(trigger);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Amina' } });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
