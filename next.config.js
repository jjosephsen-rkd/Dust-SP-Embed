/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from bundling botbuilder and its Node.js-native dependencies
      const existing = config.externals || [];
      config.externals = [
        ...existing,
        'botbuilder',
        'botframework-connector',
        'botframework-schema',
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
