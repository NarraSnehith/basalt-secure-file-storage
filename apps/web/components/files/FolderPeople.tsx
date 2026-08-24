'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Modal } from '@/components/ui/Modal';
import { IconCheck, IconClock, IconPlus, IconShield, IconSpinner, IconTrash } from '@/components/ui/icons';
import type { Collaborator, CollaboratorRole, Folder } from '@/lib/types';

const ROLES: Array<{ value: CollaboratorRole; label: string; blurb: string }> = [
  { value: 'viewer', label: 'Viewer', blurb: 'Can open and download everything in the folder.' },
  { value: 'contributor', label: 'Contributor', blurb: 'Can also add files, and manage the ones they add.' },
  { value: 'editor', label: 'Editor', blurb: 'Can also rename, move and bin anything in the folder.' },
];

/**
 * Managing the people a folder is shared with.
 *
 * The contrast with a share link is the point, so the sheet says it plainly:
 * this is a named person whose access can be withdrawn on its own, not a link
 * whose only security is that nobody passed it on.
 */
export function FolderPeople({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Collaborator[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CollaboratorRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { people: list } = await api.get<{ people: Collaborator[] }>(
        `/collab/folders/${folder.id}/people`,
      );
      setPeople(list);
    } catch (err) {
      if (err instanceof ApiError) toast.error('Could not load the guest list', err.message);
      setPeople([]);
    }
  }, [folder.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/collab/folders/${folder.id}/people`, { email: address, role });
      setEmail('');
      await load();
      toast.success(`${address} can now reach “${folder.name}”`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.field('email') ?? err.message) : 'Could not share the folder.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (person: Collaborator) => {
    try {
      await api.del(`/collab/folders/${folder.id}/people/${person.id}`);
      setPeople((current) => (current ?? []).filter((p) => p.id !== person.id));
      toast.success(`${person.email} no longer has access`, 'Everyone else is unaffected.');
    } catch (err) {
      toast.error('Could not remove them', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Share this folder"
      description={folder.name}
      width={32}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Done
        </button>
      }
    >
      <div
        className="flex items-start gap-3 rounded-md p-3"
        style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}
      >
        <span className="mt-0.5" style={{ color: 'var(--text-faint)' }}>
          <IconShield size={15} />
        </span>
        <p className="text-[0.75rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          These are people, not links. Access follows the account that owns the address, so you can
          take it back from one person without disturbing anybody else — and everything they do is
          recorded under their name.
        </p>
      </div>

      <div className="mt-4">
        <label className="label">Invite by email</label>
        <div className="flex gap-2">
          <input
            className={`field ${error ? 'field-error' : ''}`}
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void invite();
            }}
          />
          <button type="button" className="btn btn-primary shrink-0" onClick={invite} disabled={busy || !email.trim()}>
            {busy ? <IconSpinner size={13} /> : <IconPlus size={13} />}
            Invite
          </button>
        </div>
        {error ? (
          <p className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--color-rust)' }} role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
            They do not need an account yet — the invitation attaches itself when they make one.
          </p>
        )}
      </div>

      <div className="mt-3">
        <span className="label">Their role</span>
        <div className="space-y-1.5">
          {ROLES.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors"
              style={{
                background: role === option.value ? 'var(--accent-wash)' : 'transparent',
                border: `1px solid ${role === option.value ? 'color-mix(in oklab, var(--accent) 28%, transparent)' : 'var(--line)'}`,
              }}
              onClick={() => setRole(option.value)}
            >
              <span
                className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
                style={{
                  border: `1px solid ${role === option.value ? 'var(--accent)' : 'var(--line-strong)'}`,
                  background: role === option.value ? 'var(--accent)' : 'transparent',
                }}
              >
                {role === option.value ? <IconCheck size={9} style={{ color: 'var(--accent-ink)' }} /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.8125rem]">{option.label}</span>
                <span className="block text-[0.75rem] leading-snug" style={{ color: 'var(--text-dim)' }}>
                  {option.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <p className="eyebrow mb-2">Who has access</p>
        {people === null ? (
          <div className="skeleton h-12 rounded-md" />
        ) : people.length === 0 ? (
          <p className="text-[0.8125rem]" style={{ color: 'var(--text-faint)' }}>
            Only you, so far.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {people.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-2.5 rounded-md p-2"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[0.75rem]"
                  style={{
                    background: person.active ? 'var(--accent-wash)' : 'var(--hover)',
                    color: person.active ? 'var(--accent)' : 'var(--text-faint)',
                    border: '1px solid var(--line)',
                  }}
                >
                  {(person.displayName ?? person.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem]">
                    {person.displayName ?? person.email}
                  </span>
                  <span className="meta block truncate">
                    {person.displayName ? `${person.email} · ` : ''}
                    {person.role}
                    {person.lastSeenAt ? ` · last opened ${relativeTime(person.lastSeenAt)}` : ''}
                  </span>
                </span>
                {!person.active ? (
                  <span
                    className="chip shrink-0"
                    title="Waiting for an account with this address"
                    style={{ color: 'var(--color-clay)', background: 'color-mix(in oklab, var(--color-clay) 14%, transparent)' }}
                  >
                    <IconClock size={9} />
                    <span className="ml-1">pending</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-icon shrink-0"
                  onClick={() => void revoke(person)}
                  aria-label={`Remove ${person.email}`}
                  title="Remove"
                >
                  <IconTrash size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
