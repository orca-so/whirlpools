import NextBundleAnalyzer from "@next/bundle-analyzer";

const nextConfig = {
  webpack(config) {
    config.experiments.asyncWebAssembly = true;
    return config;
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: true,
};

const withBundleAnalyzer = NextBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzer(nextConfig);
