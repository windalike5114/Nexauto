/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXAUTO_BUILD_DIR || '.next',
  typedRoutes: true,
  outputFileTracingRoot: process.cwd(),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**"
      }
    ]
  }
};

export default nextConfig;
