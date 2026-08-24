import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

/**
 * One .env at the repository root configures both services, so this reads it
 * here rather than keeping a second copy under apps/web.
 */
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  // Loaded lazily: dotenv is a dev dependency of the API workspace.
  const dotenv = require('dotenv') as typeof import('dotenv');
  dotenv.config({ path: rootEnv, override: false });
}

const API_ORIGIN = process.env.API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Inlined into the client bundle so lib/api.ts knows where to send requests.
  env: { NEXT_PUBLIC_API_BASE: API_BASE },

  /**
   * Same-origin deployments keep working: /api/* is forwarded to the API
   * service, so setting NEXT_PUBLIC_API_BASE=/api is all it takes to run both
   * behind a single hostname. (In development the browser talks to the API
   * directly instead — the dev rewrite proxy cannot carry large uploads.)
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
