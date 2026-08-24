import Link from 'next/link';
import { ColumnArt } from '@/components/brand/ColumnArt';
import { Wordmark } from '@/components/brand/Logo';

/**
 * Sign-in shell: the form on the left, a formation on the right. The art is
 * generated, not an asset — it costs nothing to ship and it is unmistakably
 * this product rather than a stock illustration of a person at a laptop.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[23rem]">{children}</div>
        </div>
        <p className="meta">Basalt · secure file storage</p>
      </div>

      <aside
        className="relative hidden overflow-hidden lg:block"
        style={{ background: 'var(--panel)', borderLeft: '1px solid var(--line)' }}
      >
        <div className="absolute inset-0" style={{ color: 'var(--line-strong)' }} aria-hidden>
          <ColumnArt seed={31} columns={22} className="h-full w-full" />
        </div>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, transparent 20%, var(--panel) 95%)' }} aria-hidden />
        <div className="relative flex h-full flex-col justify-end p-12">
          <blockquote>
            <p className="text-[1.625rem] leading-[1.25] tracking-[-0.015em]" style={{ fontFamily: 'var(--font-display)' }}>
              Basalt cools from the outside in.
              <br />
              <span style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}>That is why it cracks into hexagons.</span>
            </p>
          </blockquote>
          <p className="mt-6 max-w-[24rem] text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Structure comes from constraints, not decoration. The same idea runs through this app:
            private until you decide otherwise, and a record of everything that moved.
          </p>
        </div>
      </aside>
    </div>
  );
}
