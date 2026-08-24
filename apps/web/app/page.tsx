'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ColumnArt } from '@/components/brand/ColumnArt';
import { Wordmark } from '@/components/brand/Logo';
import {
  IconActivity, IconChevron, IconClock, IconGlobe, IconLock, IconShield, IconUpload,
} from '@/components/ui/icons';

const PILLARS = [
  {
    icon: IconLock,
    title: 'Private by default',
    body: 'Every file starts private and stays that way until you say otherwise. Access is checked per file, per request — an id you do not own is indistinguishable from one that does not exist.',
  },
  {
    icon: IconGlobe,
    title: 'Links you can take back',
    body: 'Publish a file with one switch, or issue a link with its own password, expiry and download budget. Revoke any of them and the door closes on the next request.',
  },
  {
    icon: IconShield,
    title: 'Content, not claims',
    body: 'Uploads are identified from their magic bytes, never the browser’s say-so. Anything that could execute is served as a download inside a sandboxing policy.',
  },
  {
    icon: IconActivity,
    title: 'A trail you can read',
    body: 'Uploads, downloads, renames, link views, failed passwords — all recorded with time and address, and shown back to you in plain language.',
  },
];

const SPECS = [
  ['Upload ceiling', '512 MB per file, streamed'],
  ['Password hashing', 'Argon2id, OWASP parameters'],
  ['Session model', 'Rotating refresh tokens'],
  ['Integrity', 'SHA-256 recorded per file'],
  ['Storage', 'Local disk or any S3 API'],
  ['Trash window', '30 days, then purged'],
];

export default function LandingPage() {
  const { user, loading } = useAuth();

  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex h-16 w-full max-w-[76rem] items-center justify-between px-5">
        <Wordmark />
        <nav className="flex items-center gap-1.5">
          {loading ? (
            <span className="skeleton h-8 w-24 rounded-md" />
          ) : user ? (
            <Link href="/vault" className="btn btn-primary">
              Open your drive
              <IconChevron size={13} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/register" className="btn btn-primary">
                Create an account
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ borderBottom: '1px solid var(--line)' }}>
        <div
          className="pointer-events-none absolute -right-20 bottom-0 hidden h-[34rem] w-[32rem] opacity-70 lg:block"
          style={{ color: 'var(--line-strong)' }}
          aria-hidden
        >
          <ColumnArt seed={19} columns={30} className="h-full w-full" />
        </div>

        <div className="relative mx-auto w-full max-w-[76rem] px-5 py-20 sm:py-28">
          <p className="eyebrow">Secure file storage</p>
          <h1
            className="mt-4 max-w-[36rem] text-[2.75rem] leading-[1.04] tracking-[-0.02em] sm:text-[3.75rem]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Somewhere solid to
            <br />
            put your files.
          </h1>
          <p className="mt-6 max-w-[34rem] text-[0.9375rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            Basalt is a file store built the way a file store should be: nothing is public until you
            publish it, every link can be revoked, and every byte that moves is written down. Upload a
            gigabyte or a text file — same rules either way.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <Link href={user ? '/vault' : '/register'} className="btn btn-primary h-10 px-4">
              <IconUpload size={14} />
              {user ? 'Open your drive' : 'Start storing'}
            </Link>
            <Link href="/login" className="btn btn-outline h-10 px-4">
              Sign in
            </Link>
            <span className="meta ml-1 hidden sm:inline">Demo account on the sign-in page</span>
          </div>

          <dl className="mt-16 grid max-w-[40rem] grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            {[
              ['512 MB', 'per-file ceiling'],
              ['SHA-256', 'on every upload'],
              ['0', 'files public by default'],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="text-[1.5rem] leading-none" style={{ fontFamily: 'var(--font-display)' }}>
                  {value}
                </dt>
                <dd className="meta mt-1.5">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── pillars ──────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[76rem] px-5 py-20">
        <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <article key={pillar.title}>
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md"
                  style={{ background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid color-mix(in oklab, var(--accent) 22%, transparent)' }}
                >
                  <Icon size={15} />
                </span>
                <h2 className="mt-4 text-[1.0625rem] tracking-[-0.01em]">{pillar.title}</h2>
                <p className="mt-2 text-[0.875rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                  {pillar.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── spec sheet ───────────────────────────────────────────────────── */}
      <section style={{ borderTop: '1px solid var(--line)', background: 'var(--panel)' }}>
        <div className="mx-auto w-full max-w-[76rem] px-5 py-16">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.25rem]" style={{ fontFamily: 'var(--font-display)' }}>
              The specifics
            </h2>
            <span className="meta">no asterisks</span>
          </div>
          <dl className="mt-8 grid gap-x-10 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
            {SPECS.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                <dt className="text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
                  {label}
                </dt>
                <dd className="meta text-right" style={{ color: 'var(--text)' }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center justify-between gap-3 px-5 py-8">
        <span className="meta flex items-center gap-2">
          <IconClock size={12} />
          Basalt · built as a full-stack engineering exercise
        </span>
        <Link href="/login" className="link text-[0.8125rem]">
          Sign in
        </Link>
      </footer>
    </main>
  );
}
