import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One .env at the repository root configures both services, so this reads it
 * here rather than keeping a second copy under apps/web.
 */
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  // Loaded lazily: dotenv is a dev dependency of the API workspace.
  const { config } = await import('dotenv');
  config({ path: rootEnv, override: false });
}

const API_ORIGIN = process.env.API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

/**
 * Plain JavaScript on purpose.
 *
 * Next reads this file at *runtime*, and a .ts config makes it install
 * TypeScript on boot when the production image has no dev dependencies —
 * needing network access and a writable node_modules just to start. JSDoc keeps
 * the editor types.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Inlined into the client bundle so lib/api.ts knows where to send requests.
  env: { NEXT_PUBLIC_API_BASE: API_BASE },

  /**
   * A convenience for running `next start` on its own, not the deployment path.
   *
   * This rewrite buffers proxied request bodies in memory and truncates them at
   * 10 MB, so it cannot carry uploads — which is why development points the
   * browser straight at the API, and why the container puts nginx in front and
   * never lets an /api request reach Next at all. See
   * docker/nginx.conf.template.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
