'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { requestNewFolder, requestUpload } from '@/lib/ui-events';
import { VaultProvider } from '@/lib/vault-context';
import { Logo } from '@/components/brand/Logo';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { Rail } from '@/components/shell/Rail';
import { TopBar } from '@/components/shell/TopBar';
import { TransferDock } from '@/components/upload/TransferDock';

/**
 * The application shell.
 *
 * Auth is resolved once here: while the session is being restored the shell
 * shows its own skeleton rather than flashing the sign-in page, and a genuinely
 * signed-out visitor is redirected with `next` set so they land where they were
 * heading.
 */
export default function VaultLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  useEffect(() => setNavOpen(false), [pathname]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="animate-pulse" style={{ color: 'var(--text-faint)', animation: 'pulse-line 1.4s ease-in-out infinite' }}>
          <Logo size={26} />
        </span>
      </div>
    );
  }

  return (
    <VaultProvider>
      <div className="flex h-dvh overflow-hidden">
        <div className="hidden lg:block">
          <Rail />
        </div>

        {navOpen ? (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <div
              className="animate-fade absolute inset-0"
              style={{ background: 'color-mix(in oklab, var(--page) 70%, transparent)' }}
              onClick={() => setNavOpen(false)}
            />
            <div className="animate-slide-in absolute inset-y-0 left-0">
              <Rail onClose={() => setNavOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenNav={() => setNavOpen(true)} />
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
      </div>

      <TransferDock />
      <CommandPalette onUpload={requestUpload} onNewFolder={requestNewFolder} />
    </VaultProvider>
  );
}
