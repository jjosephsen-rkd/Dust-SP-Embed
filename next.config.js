/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep botbuilder and its deps as native Node.js modules (not bundled).
  // This works with both Turbopack (Next.js 16 default) and webpack.
  serverExternalPackages: ['botbuilder', 'botframework-connector', 'botframework-schema'],
};

module.exports = nextConfig;
