import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step); Next transpiles them.
  transpilePackages: ['@ably-quiz/core', '@ably-quiz/agent-runner'],
};

export default nextConfig;
