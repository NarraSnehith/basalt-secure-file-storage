'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ColumnArt } from '@/components/brand/ColumnArt';
import { Wordmark } from '@/components/brand/Logo';
import {
  IconActivity, IconChart, IconChevron, IconClock, IconFingerprint, IconGlobe, IconHistory,
  IconInbox, IconInfo, IconLayers, IconLock, IconResume, IconSearch, IconShield, IconUpload,
  IconUsers,
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

/**
 * The things this does that a plain uploader does not. Ordered by how quickly
 * you would notice them missing rather than by how hard they were to build.
 */
const FEATURES = [
  {
    icon: IconResume,
    title: 'Uploads that survive the network',
    body: 'Large files go up in chunks, each one checksummed on arrival. Close the tab, lose your connection, come back tomorrow — it resumes from the last chunk that landed rather than starting again.',
  },
  {
    icon: IconFingerprint,
    title: 'The same bytes stored once',
    body: 'Files are addressed by the SHA-256 of their contents, so uploading a copy you already have costs nothing and finishes instantly. Your quota is charged for what is actually stored.',
  },
  {
    icon: IconHistory,
    title: 'Every version kept',
    body: 'Re-uploading under a name you already used makes a new version instead of overwriting. Older ones stay downloadable, and restoring one adds it on top rather than throwing the newer away.',
  },
  {
    icon: IconSearch,
    title: 'Search inside the files',
    body: 'Text documents are indexed by their contents, so a word you remember from a document finds it even when you have forgotten what you called it. Filenames match on fragments too.',
  },
  {
    icon: IconUsers,
    title: 'Folders shared with people',
    body: 'Invite someone by email as a viewer, contributor or editor. They need no account yet — the invitation attaches itself when they make one — and revoking one person leaves everybody else alone.',
  },
  {
    icon: IconInbox,
    title: 'Ask others for files',
    body: 'Issue a link that lets somebody send you files without an account or a login, capped at a number of uploads you choose. Everything they send lands in the folder you nominated.',
  },
  {
    icon: IconGlobe,
    title: 'Links with conditions',
    body: 'A share link can carry its own password, an expiry date and a download budget. Any of the three can be changed later, and revoking one takes effect on the next request.',
  },
  {
    icon: IconActivity,
    title: 'Receipts for what you shared',
    body: 'See who opened a link, when, and from where — including the attempts that got the password wrong. Useful for knowing a document arrived without having to ask.',
  },
  {
    icon: IconChart,
    title: 'Where the space went',
    body: 'A breakdown of your largest files, which ones are duplicates, what version history is costing you and what the bin is still holding on to — with the reclaimable figure stated outright.',
  },
  {
    icon: IconLayers,
    title: 'A bin that behaves',
    body: 'Deleting moves a file to the bin for thirty days and keeps its share links dead in the meantime. Restore puts it back where it was, with its versions and its history intact.',
  },
];

const DEMO_STEPS = [
  'Open the sign-in page.',
  'Press “Use the demo account” — the credentials fill themselves in.',
  'You land in a drive already holding folders, files, live share links and a file request.',
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

      {/* ── try it ───────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}
      >
        <div
          className="pointer-events-none absolute -top-24 right-0 hidden h-[26rem] w-[26rem] opacity-[0.18] md:block"
          style={{ color: 'var(--accent)' }}
          aria-hidden
        >
          <ColumnArt seed={41} variant="top" className="h-full w-full" />
        </div>

        <div className="relative mx-auto w-full max-w-[76rem] px-5 py-14">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="eyebrow">Have a look without signing up</p>
              <h2 className="mt-3 text-[1.5rem] tracking-[-0.01em]" style={{ fontFamily: 'var(--font-display)' }}>
                There is a demo account, already full of things.
              </h2>
              <ol className="mt-5 space-y-2.5">
                {DEMO_STEPS.map((step, i) => (
                  <li key={step} className="flex gap-3 text-[0.9375rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem]"
                      style={{
                        background: 'var(--accent-wash)',
                        color: 'var(--accent)',
                        border: '1px solid color-mix(in oklab, var(--accent) 26%, transparent)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <Link href="/login" className="btn btn-primary mt-6 h-10 px-4">
                Take me to the demo
                <IconChevron size={13} />
              </Link>
            </div>

            <div
              className="rounded-lg p-5"
              style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}
            >
              <p className="eyebrow">Or type them yourself</p>
              <dl className="mt-4 space-y-3">
                {[
                  ['Email', 'demo@basalt.build'],
                  ['Password', 'stone-and-ash-2026'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="meta">{label}</dt>
                    <dd
                      className="mt-1 select-all break-all text-[0.9375rem]"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                One of the seeded share links is password protected. That password is{' '}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>quartz-seam</span>.
              </p>
            </div>
          </div>
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

      {/* ── what makes it different ──────────────────────────────────────── */}
      <section style={{ borderTop: '1px solid var(--line)', background: 'var(--panel)' }}>
        <div className="mx-auto w-full max-w-[76rem] px-5 py-20">
          <p className="eyebrow">Beyond somewhere to put a file</p>
          <h2
            className="mt-3 max-w-[30rem] text-[1.875rem] leading-[1.15] tracking-[-0.015em]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Ten things it does that an uploader does not.
          </h2>

          <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="group relative overflow-hidden rounded-lg p-5 transition-colors"
                  style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}
                >
                  {/* A different formation per card, from the seeded generator. */}
                  <span
                    className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 opacity-[0.09] transition-opacity group-hover:opacity-[0.16]"
                    style={{ color: 'var(--accent)' }}
                    aria-hidden
                  >
                    <ColumnArt seed={feature.title.length * 7 + 3} variant="top" className="h-full w-full" />
                  </span>

                  <span
                    className="relative flex h-9 w-9 items-center justify-center rounded-md"
                    style={{
                      background: 'var(--accent-wash)',
                      color: 'var(--accent)',
                      border: '1px solid color-mix(in oklab, var(--accent) 22%, transparent)',
                    }}
                  >
                    <Icon size={16} />
                  </span>
                  <h3 className="relative mt-4 text-[1rem] tracking-[-0.01em]">{feature.title}</h3>
                  <p className="relative mt-2 text-[0.875rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                    {feature.body}
                  </p>
                </article>
              );
            })}
          </div>
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

      {/* ── what the free tier costs you ─────────────────────────────────── */}
      <section style={{ borderTop: '1px solid var(--line)' }}>
        <div className="mx-auto w-full max-w-[76rem] px-5 py-12">
          <div
            className="flex flex-col gap-4 rounded-lg p-5 sm:flex-row sm:gap-5"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
              style={{
                background: 'color-mix(in oklab, var(--color-clay) 15%, transparent)',
                color: 'var(--color-clay)',
                border: '1px solid color-mix(in oklab, var(--color-clay) 26%, transparent)',
              }}
            >
              <IconInfo size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[1rem] tracking-[-0.01em]">This deployment runs on free infrastructure</h2>
              <p className="mt-2 text-[0.875rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                <strong style={{ color: 'var(--text)' }}>Every feature on this page works here.</strong>{' '}
                Nothing is stubbed, mocked or disabled — uploads land in real object storage, share links
                are real links, and the search really reads your files. What is limited is only{' '}
                <em>how much</em> you may store, because the object store and database are on free plans
                and the point is that this never generates a bill.
              </p>
              <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
                {[
                  ['1 GB', 'per account'],
                  ['6 GB', 'across the whole service'],
                  ['512 MB', 'per individual file'],
                ].map(([value, label]) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <dt className="text-[1.125rem] leading-none" style={{ fontFamily: 'var(--font-display)' }}>
                      {value}
                    </dt>
                    <dd className="meta">{label}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                Reach the service-wide figure and uploads are declined with a clear message while
                everything already stored keeps working — reading, downloading and sharing are
                unaffected. Raising any of the three is one environment variable on a paid plan; the
                code has no ceiling of its own. The instance also sleeps after fifteen minutes of
                quiet, so the very first request after a lull takes about a minute to answer.
              </p>
            </div>
          </div>
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
