'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBytes, formatDateTime, relativeTime } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useVault } from '@/lib/vault-context';
import { StorageCore } from '@/components/shell/StorageCore';
import { Confirm } from '@/components/ui/Confirm';
import { Field } from '@/components/ui/Field';
import { IconCheck, IconShield, IconSpinner, IconTrash, IconWarn } from '@/components/ui/icons';
import type { SessionInfo } from '@/lib/types';

const ACCENTS = ['ember', 'basalt', 'moss', 'lapis', 'clay', 'ash'] as const;

/** "Chrome on macOS" out of a user-agent string — good enough to recognise a device. */
function describeAgent(agent: string | null): string {
  if (!agent) return 'Unknown device';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : /Firefox\//.test(agent)
            ? 'Firefox'
            : /curl/i.test(agent)
              ? 'curl'
              : 'Browser';
  const platform = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Mac OS X/.test(agent)
        ? 'macOS'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  return platform ? `${browser} on ${platform}` : browser;
}

export default function SettingsPage() {
  const { user, patchUser, signOut } = useAuth();
  const { stats } = useVault();
  const toast = useToast();
  const router = useRouter();

  const [name, setName] = useState(user?.displayName ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [passwordError, setPasswordError] = useState<ApiError | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const loadSessions = useCallback(async () => {
    try {
      const { sessions: list } = await api.get<{ sessions: SessionInfo[] }>('/auth/sessions');
      setSessions(list);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const { user: updated } = await api.patch<{ user: typeof user }>('/auth/me', { displayName: name.trim() });
      if (updated) patchUser(updated);
      toast.success('Profile saved');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingProfile(false);
    }
  };

  const pickAccent = async (accent: string) => {
    patchUser({ accent });
    try {
      await api.patch('/auth/me', { accent });
    } catch {
      toast.error('Could not save the accent');
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError(null);
    try {
      await api.post('/auth/password', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      toast.success('Password changed', 'Every other device has been signed out.');
      void loadSessions();
    } catch (err) {
      if (err instanceof ApiError) setPasswordError(err);
      else toast.error('Could not change the password');
    } finally {
      setSavingPassword(false);
    }
  };

  const revokeSession = async (session: SessionInfo) => {
    try {
      await api.del(`/auth/sessions/${session.id}`);
      if (session.current) {
        await signOut();
        return;
      }
      setSessions((current) => (current ?? []).filter((s) => s.id !== session.id));
      toast.success('Device signed out');
    } catch (err) {
      toast.error('Could not sign that device out', err instanceof ApiError ? err.message : undefined);
    }
  };

  const revokeOthers = async () => {
    try {
      const { revoked } = await api.del<{ revoked: number }>('/auth/sessions');
      toast.success(revoked ? `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}` : 'No other devices were signed in');
      void loadSessions();
    } catch {
      toast.error('Could not sign the other devices out');
    }
  };

  const deleteAccount = async () => {
    try {
      await api.post('/auth/delete-account', { password: deletePassword, confirm: 'delete my account' });
      router.replace('/');
    } catch (err) {
      toast.error('Could not delete the account', err instanceof ApiError ? err.message : undefined);
      throw err;
    }
  };

  if (!user) return null;

  return (
    <div className="overflow-y-auto pb-24">
      <div className="mx-auto max-w-[46rem] space-y-8 px-4 py-6 sm:px-6">
        <header>
          <h1 className="text-[1.5rem] tracking-[-0.015em]" style={{ fontFamily: 'var(--font-display)' }}>
            Settings
          </h1>
          <p className="mt-1 text-[0.875rem]" style={{ color: 'var(--text-dim)' }}>
            Account since {formatDateTime(user.createdAt)}
          </p>
        </header>

        {/* ── storage ── */}
        <section className="panel p-4">
          <h2 className="text-[0.9375rem] font-medium">Storage</h2>
          <div className="mt-4 flex flex-wrap items-start gap-8">
            <StorageCore stats={stats} />
            <dl className="grid grow grid-cols-2 gap-x-6 gap-y-3">
              {[
                ['Files', stats ? stats.fileCount.toLocaleString() : '—'],
                ['Folders', stats ? stats.folderCount.toLocaleString() : '—'],
                ['Public files', stats ? stats.publicCount.toLocaleString() : '—'],
                ['In trash', stats ? formatBytes(stats.trashBytes) : '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="label mb-0.5">{label}</dt>
                  <dd className="tnum text-[0.9375rem]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── profile ── */}
        <section className="panel p-4">
          <h2 className="text-[0.9375rem] font-medium">Profile</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Display name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            <Field label="Email" value={user.email} readOnly disabled hint="Contact support to change this." />
          </div>

          <div className="mt-4">
            <span className="label">Accent</span>
            <div className="flex gap-1.5">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  aria-label={accent}
                  aria-pressed={user.accent === accent}
                  onClick={() => void pickAccent(accent)}
                  className="flex h-7 w-7 items-center justify-center rounded-md capitalize transition-transform hover:scale-105"
                  style={{
                    background: `var(--kind-${accent === 'ember' ? 'code' : accent === 'basalt' ? 'binary' : accent === 'ash' ? 'text' : accent === 'lapis' ? 'document' : accent === 'moss' ? 'spreadsheet' : 'presentation'})`,
                    border: user.accent === accent ? '2px solid var(--text)' : '1px solid var(--line)',
                    opacity: user.accent === accent ? 1 : 0.6,
                  }}
                >
                  {user.accent === accent ? <IconCheck size={12} style={{ color: 'var(--page)' }} /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveProfile}
              disabled={savingProfile || !name.trim() || name.trim() === user.displayName}
            >
              {savingProfile ? <IconSpinner size={13} /> : null}
              Save profile
            </button>
          </div>
        </section>

        {/* ── password ── */}
        <section className="panel p-4">
          <h2 className="text-[0.9375rem] font-medium">Password</h2>
          <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
            Changing it signs every other device out. This one stays.
          </p>
          <form onSubmit={changePassword} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              error={passwordError?.field('currentPassword')}
              onChange={(event) => setPasswords((p) => ({ ...p, currentPassword: event.target.value }))}
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              error={passwordError?.field('newPassword')}
              hint="Ten characters or more."
              onChange={(event) => setPasswords((p) => ({ ...p, newPassword: event.target.value }))}
            />
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                className="btn btn-outline"
                disabled={savingPassword || !passwords.currentPassword || !passwords.newPassword}
              >
                {savingPassword ? <IconSpinner size={13} /> : null}
                Change password
              </button>
            </div>
          </form>
        </section>

        {/* ── sessions ── */}
        <section className="panel p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[0.9375rem] font-medium">
                <IconShield size={14} style={{ color: 'var(--text-faint)' }} />
                Signed-in devices
              </h2>
              <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
                Revoking takes effect on the next request, not in fifteen minutes.
              </p>
            </div>
            {sessions && sessions.length > 1 ? (
              <button type="button" className="btn btn-sm btn-outline" onClick={revokeOthers}>
                Sign out others
              </button>
            ) : null}
          </div>

          <ul className="mt-4 space-y-1.5">
            {sessions === null ? <li className="skeleton h-12 rounded-md" /> : null}
            {sessions?.map((session) => (
              <li
                key={session.id}
                className="flex items-center gap-3 rounded-md p-2.5"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[0.8125rem]">
                    {describeAgent(session.userAgent)}
                    {session.current ? (
                      <span className="chip" style={{ color: 'var(--color-moss)', background: 'color-mix(in oklab, var(--color-moss) 14%, transparent)' }}>
                        this device
                      </span>
                    ) : null}
                  </p>
                  <p className="meta mt-0.5">
                    {session.ip ?? 'unknown address'} · active {relativeTime(session.lastUsedAt)} · expires{' '}
                    {relativeTime(session.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void revokeSession(session)}
                >
                  {session.current ? 'Sign out' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ── danger ── */}
        <section className="panel p-4" style={{ borderColor: 'color-mix(in oklab, var(--color-rust) 30%, var(--line))' }}>
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-medium" style={{ color: 'var(--color-rust)' }}>
            <IconWarn size={14} />
            Delete account
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            Removes your account, every file, folder and share link, and the stored bytes behind them.
            There is no recovery and no export afterwards.
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <Field
              label="Confirm with your password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              className="w-full max-w-[16rem]"
            />
            <button
              type="button"
              className="btn btn-danger"
              disabled={!deletePassword}
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={13} />
              Delete everything
            </button>
          </div>
        </section>
      </div>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteAccount}
        title="Delete your account?"
        body={
          stats
            ? `${stats.fileCount} files (${formatBytes(stats.usedBytes)}) and every share link will be destroyed. This cannot be undone.`
            : 'Everything in this account will be destroyed. This cannot be undone.'
        }
        confirmLabel="Delete account"
        requirePhrase="delete my account"
        danger
      />
    </div>
  );
}
