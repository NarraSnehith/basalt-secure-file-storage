import type { Metadata } from 'next';

/**
 * Share pages must never be indexed: the whole point of an unguessable slug is
 * that it is only known to the people the owner sent it to.
 */
export const metadata: Metadata = {
  title: 'Shared file',
  robots: { index: false, follow: false, nocache: true },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
