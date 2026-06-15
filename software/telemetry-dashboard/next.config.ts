import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.1.154", "10.0.1.154:3000"],
  output: "standalone",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
