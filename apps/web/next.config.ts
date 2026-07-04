import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cp/cf", "@cp/db"],
};

export default nextConfig;
