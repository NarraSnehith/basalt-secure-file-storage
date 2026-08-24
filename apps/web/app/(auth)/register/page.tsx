'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Field } from '@/components/ui/Field';
import { IconCheck, IconSpinner } from '@/components/ui/icons';

/** Live, honest feedback on the two rules the server actually enforces. */
function strength(password: string): { score: number; label: string; tone: string } {
  if (!password) return { score: 0, label: 'Ten characters minimum', tone: 'var(--text-faint)' };
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 16) score += 1;
  if (/[^a-zA-Z0-9]/.test(password) || /\d/.test(password)) score += 1;
  if (new Set(password).size > 8) score += 1;
  const labels = ['Too short', 'Workable', 'Good', 'Strong', 'Very strong'];
  const tones = ['var(--color-rust)', 'var(--color-clay)', 'var(--color-clay)', 'var(--color-moss)', 'var(--color-moss)'];
  return { score, label: labels[score]!, tone: tones[score]! };
}

export default function RegisterPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const meter = useMemo(() => strength(form.password), [form.password]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp(form);
      router.replace('/vault');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Could not create the account.'));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) => (error instanceof ApiError ? error.field(name) : undefined);
  const generalError = error instanceof ApiError ? (error.fields ? undefined : error.message) : error?.message;

  return (
    <div>
      <h1 className="text-[1.75rem] leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-display)' }}>
        Create an account
      </h1>
      <p className="mt-1.5 text-[0.875rem]" style={{ color: 'var(--text-dim)' }}>
        Ten gigabytes, private by default.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field
          label="Name"
          name="name"
          autoComplete="name"
          autoFocus
          required
          value={form.displayName}
          error={fieldError('displayName')}
          onChange={set('displayName')}
          placeholder="Ada Reyes"
        />
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={form.email}
          error={fieldError('email')}
          onChange={set('email')}
          placeholder="you@example.com"
        />
        <div>
          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={form.password}
            error={fieldError('password')}
            onChange={set('password')}
            placeholder="Ten characters or more"
          />
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="h-[3px] flex-1 rounded-full transition-colors"
                  style={{ background: i < meter.score ? meter.tone : 'var(--line)' }}
                />
              ))}
            </div>
            <span className="meta" style={{ color: meter.tone }}>
              {meter.label}
            </span>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
            <IconCheck size={12} className="mt-0.5 shrink-0" />
            Length beats symbols. Passwords are hashed with Argon2id and never stored in the clear.
          </p>
        </div>

        {generalError ? (
          <p
            className="rounded-md px-3 py-2 text-[0.8125rem]"
            style={{ background: 'color-mix(in oklab, var(--color-rust) 12%, transparent)', color: 'var(--color-rust)' }}
            role="alert"
          >
            {generalError}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary h-10 w-full" disabled={busy}>
          {busy ? <IconSpinner size={14} /> : null}
          Create account
        </button>
      </form>

      <p className="mt-8 text-center text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
        Already have one?{' '}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
