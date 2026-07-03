import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cp/cf", "@cp/rating", "@cp/db"],
};

export default nextConfig;
