import type { NextConfig } from 'next';

// Server configuration only. Requests cannot select the upstream destination.
const apiOrigin = process.env['API_UPSTREAM_ORIGIN'] ?? 'http://127.0.0.1:3001';
if (
  !URL.canParse(apiOrigin) ||
  new URL(apiOrigin).origin !== apiOrigin ||
  !['http:', 'https:'].includes(new URL(apiOrigin).protocol)
) {
  throw new Error('Invalid API_UPSTREAM_ORIGIN');
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@lucy-spa/ui'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async redirects() {
    return [{ source: '/', destination: '/vi', permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
