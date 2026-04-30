/** @type {import('next').NextConfig} */
// API_URL: used server-side for rewrites (read at runtime by Next.js server).
// Falls back to localhost:8000 which is the desktop default.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.BACKEND_URL ??
  "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [],
  },

  // ── Security headers ──────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent the page from being embedded in iframes (clickjacking)
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer policy – don't leak URL to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Basic permissions policy
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Content Security Policy
          // script-src 'unsafe-inline' is required by Next.js inline hydration
          // scripts and by the print() call in the PDF Blob exports.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },

  // ── API proxy rewrite ─────────────────────────────────────────────────
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
