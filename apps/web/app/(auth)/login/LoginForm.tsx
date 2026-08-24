'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Field } from '@/components/ui/Field';
import { IconChevron, IconSpinner } from '@/components/ui/icons';

const DEMO = { email: 'demo@basalt.build', password: 'stone-and-ash-2026' };

export function LoginForm() {
  const { signIn, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/vault';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, router, next]);

  const submit = async (event: React.FormEvent, credentials = { email, password }) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(credentials.email, credentials.password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Could not sign in.'));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) => (error instanceof ApiError ? error.field(name) : undefined);
  const generalError =
    error instanceof ApiError ? (error.fields ? undefined : error.message) : error?.message;

  return (
    <div>
      <h1 className="text-[1.75rem] leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-display)' }}>
        Welcome back
      </h1>
      <p className="mt-1.5 text-[0.875rem]" style={{ color: 'var(--text-dim)' }}>
        Sign in to reach your files.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          error={fieldError('email')}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          error={fieldError('password')}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••••"
        />

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
          Sign in
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
        <span className="eyebrow">or</span>
        <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
      </div>

      <button
        type="button"
        className="btn btn-outline h-10 w-full"
        disabled={busy}
        onClick={(event) => {
          setEmail(DEMO.email);
          setPassword(DEMO.password);
          void submit(event, DEMO);
        }}
      >
        Use the demo account
        <IconChevron size={13} />
      </button>
      <p className="meta mt-2 text-center">
        {DEMO.email} · seeded with files, folders and live share links
      </p>

      <p className="mt-8 text-center text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
        No account yet?{' '}
        <Link href="/register" className="link">
          Create one
        </Link>
      </p>
    </div>
  );
}
