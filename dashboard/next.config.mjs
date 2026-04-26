/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // We read data files from the parent directory (../data, ../config).
  // This is fine because Next.js server-side code runs from the
  // dashboard/ working dir and has normal filesystem access.
  experimental: {
    // App Router is the default in Next 15; no config needed here.
  },

  // Silence the Webpack worker message; we don't use it.
  webpack: (config) => config,
};

export default nextConfig;
