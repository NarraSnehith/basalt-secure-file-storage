import type { Metadata } from 'next';

/** Upload links are private by construction; keep them out of search results. */
export const metadata: Metadata = {
  title: 'Send files',
  robots: { index: false, follow: false, nocache: true },
};

export default function UploadLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
