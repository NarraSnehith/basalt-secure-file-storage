import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider, themeBootstrapScript } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast';
import './globals.css';

/**
 * Three faces, each with a job: a serif for display type (so headings do not
 * look like UI), a grotesk for the interface, and a mono for anything the user
 * might compare digit by digit — sizes, dates, checksums, transfer rates.
 */
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Basalt — secure file storage', template: '%s · Basalt' },
  description:
    'Encrypted-at-rest file storage with per-file access control, expiring share links and a full audit trail.',
  applicationName: 'Basalt',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Basalt — secure file storage',
    description: 'Upload, organise and share files with per-file access control and a full audit trail.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
    { media: '(prefers-color-scheme: light)', color: '#f4f2ef' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Font variables belong on <html>, not <body>: the theme declares --font-sans
  // on :root, and a var() that cannot resolve there is invalid at
  // computed-value time — which silently drops the whole app to system fonts.
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applied before first paint so a light-mode user never sees a dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
