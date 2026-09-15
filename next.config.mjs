/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    allowedDevOrigins: ['192.168.100.11:3000', '192.168.100.11', 'localhost:3000'],
  },
};

export default nextConfig;