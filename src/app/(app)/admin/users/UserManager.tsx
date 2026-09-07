'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role, User } from '@/data/repositories/users';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/auth/rbac';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Drawer } from '@/design/primitives/Drawer';
import { Select, TextInput } from '@/design/primitives/Field';

export interface ScopeChoice {
  id: string;
  name: string;
  level: string;
  parentId: string | null;
}

/**
 * User administration.
 *
 * Access is a role plus a geographic scope, and the two are independent: any
 * role can be held at any scope. Empty scope means programme-wide; naming one
 * or more org units limits the account to those units and everything beneath
 * them. There is no separate "LGA user" product — the same workspace is simply
 * scoped.
 */
export function UserManager({
  users,
  scopeChoices,
  currentUserId,
  canManage,
}: {
  users: User[];
  scopeChoices: ScopeChoice[];
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'ANALYST' as Role,
    password: '',
    scope: [] as string[],
  });

  async function send(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/users', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'The change could not be saved.');
        return false;
      }
      setEditing(null);
      setCreating(false);
      setForm({ email: '', name: '', role: 'ANALYST', password: '', scope: [] });
      router.refresh();
      return true;
    } catch {
      setError('We could not reach the server. Try again in a moment.');
      return false;
    } finally {
      setPending(false);
    }
  }

  /**
   * The scope picker, grouped by state.
   *
   * The hierarchy spans two states and 43 LGAs. A flat checkbox list gives an
   * administrator no way to tell which state an LGA belongs to — and two LGAs
   * can share a name — so each state heading is selectable in its own right
   * and its LGAs are nested beneath it.
   */
  const scopeField = (value: string[], onChange: (next: string[]) => void) => {
    const toggle = (id: string, checked: boolean) =>
      onChange(checked ? [...value, id] : value.filter((entry) => entry !== id));

    const roots = scopeChoices.filter((choice) => choice.parentId === null);
    const states = scopeChoices.filter((choice) => choice.level === 'STATE');
    const childrenOf = (id: string) => scopeChoices.filter((choice) => choice.parentId === id);

    const checkbox = (choice: ScopeChoice, emphasis: boolean) => {
      // Selecting a state already covers its LGAs; showing the LGA as checked
      // too would claim a selection the administrator did not make, so the
      // child boxes are disabled and the reason is stated.
      const coveredByParent =
        choice.parentId !== null && value.includes(choice.parentId);
      return (
        <label
          key={choice.id}
          className={`flex items-center gap-2 py-0.5 text-[12px] ${
            emphasis ? 'font-medium' : ''
          } ${coveredByParent ? 'text-[var(--text-tertiary)]' : ''}`}
        >
          <input
            type="checkbox"
            checked={value.includes(choice.id) || coveredByParent}
            disabled={coveredByParent}
            onChange={(event) => toggle(choice.id, event.target.checked)}
          />
          {choice.name}
          {coveredByParent ? (
            <span className="text-[10px] text-[var(--text-tertiary)]">included by state</span>
          ) : null}
        </label>
      );
    };

    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[11px] font-medium text-[var(--text-tertiary)]">
          Geographic scope — leave all unselected for programme-wide access
        </legend>
        <div className="max-h-[22rem] overflow-y-auto rounded-[var(--radius-md)] border p-2">
          {roots.map((root) => checkbox(root, true))}
          {states.map((state) => (
            <div key={state.id} className="mt-1.5 border-t pt-1.5 first:mt-0 first:border-t-0 first:pt-0">
              {checkbox(state, true)}
              <div className="ml-4">
                {childrenOf(state.id).map((lga) => checkbox(lga, false))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
    );
  };

  return (
    <>
      {canManage ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            Add user
          </Button>
        </div>
      ) : null}

      <TableWrap>
        <thead>
          <tr>
            <Th width="24%">Name</Th>
            <Th width="26%">Email</Th>
            <Th width="18%">Role</Th>
            <Th width="20%">Scope</Th>
            <Th width="12%">Status</Th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <Tr key={user.id} interactive>
              <Td>
                <button
                  type="button"
                  onClick={() => setEditing(user)}
                  className="text-left font-medium hover:text-[var(--brand-600)] hover:underline"
                >
                  {user.name}
                </button>
              </Td>
              <Td className="text-[12px] text-[var(--text-secondary)]">{user.email}</Td>
              <Td className="text-[12px]">{ROLE_LABELS[user.role]}</Td>
              <Td className="text-[12px] text-[var(--text-tertiary)]">
                {user.scope.length === 0
                  ? 'Programme-wide'
                  : user.scope
                      .map((id) => scopeChoices.find((choice) => choice.id === id)?.name ?? id)
                      .join(', ')}
              </Td>
              <Td>
                <Badge tone={user.active ? 'positive' : 'neutral'}>
                  {user.active ? 'Active' : 'Disabled'}
                </Badge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.name ?? ''}
        description={editing?.email}
        footer={
          editing && canManage ? (
            <div className="space-y-2">
              {error ? (
                <p role="alert" className="text-[12px] text-[var(--concern-600)]">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    void send('PATCH', {
                      id: editing.id,
                      name: editing.name,
                      role: editing.role,
                      scope: editing.scope,
                    })
                  }
                >
                  Save changes
                </Button>
                {editing.id !== currentUserId ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => void send('PATCH', { id: editing.id, active: !editing.active })}
                  >
                    {editing.active ? 'Disable account' : 'Enable account'}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      >
        {editing ? (
          <div className="space-y-4">
            <TextInput
              label="Name"
              value={editing.name}
              disabled={!canManage}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
            <Select
              label="Role"
              value={editing.role}
              disabled={!canManage}
              onChange={(event) => setEditing({ ...editing, role: event.target.value as Role })}
            >
              {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              {ROLE_DESCRIPTIONS[editing.role]}
            </p>
            {canManage ? scopeField(editing.scope, (scope) => setEditing({ ...editing, scope })) : null}
            <p className="border-t pt-3 text-[11px] text-[var(--text-tertiary)]">
              Created {new Date(editing.createdAt).toLocaleDateString('en-GB')}
              {editing.lastLoginAt
                ? ` · last signed in ${new Date(editing.lastLoginAt).toLocaleString('en-GB')}`
                : ' · never signed in'}
            </p>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="Add user"
        description="The account is created immediately and can sign in with the password you set."
        footer={
          <div className="space-y-2">
            {error ? (
              <p role="alert" className="text-[12px] text-[var(--concern-600)]">
                {error}
              </p>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() => void send('POST', form)}
            >
              Create account
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TextInput
            label="Full name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <TextInput
            label="Email address"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <TextInput
            label="Initial password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            hint="At least 10 characters. Ask the user to change it after their first sign-in."
          />
          <Select
            label="Role"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {ROLE_DESCRIPTIONS[form.role]}
          </p>
          {scopeField(form.scope, (scope) => setForm({ ...form, scope }))}
        </div>
      </Drawer>
    </>
  );
}
