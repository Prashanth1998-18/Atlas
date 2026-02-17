/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export only during production build (not dev mode)
  output: process.env.NEXT_EXPORT === 'true' ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
