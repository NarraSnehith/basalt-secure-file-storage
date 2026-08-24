import Link from 'next/link';
import { ColumnArt } from '@/components/brand/ColumnArt';
import { Wordmark } from '@/components/brand/Logo';

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 opacity-60" style={{ color: 'var(--line)' }} aria-hidden>
        <ColumnArt seed={61} columns={30} className="h-full w-full" />
      </div>
      <div className="relative">
        <Wordmark />
        <h1 className="mt-8 text-[2.25rem] leading-none" style={{ fontFamily: 'var(--font-display)' }}>
          404
        </h1>
        <p className="mt-3 max-w-[24rem] text-[0.875rem]" style={{ color: 'var(--text-dim)' }}>
          Nothing is stored at this address. If you followed a share link, it may have been revoked.
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <Link href="/vault" className="btn btn-primary">
            Your drive
          </Link>
          <Link href="/" className="btn btn-outline">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
