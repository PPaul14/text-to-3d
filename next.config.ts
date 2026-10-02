import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js otherwise writes agent instruction files into the project root on
  // every dev run; this project does not keep them in version control.
  agentRules: false,
};

export default nextConfig;
