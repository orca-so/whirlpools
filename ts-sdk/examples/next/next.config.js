import NextBundleAnalyzer from "@next/bundle-analyzer";
import CopyWebpackPlugin from "copy-webpack-plugin";

const nextConfig = {
  webpack(config, { isServer }) {
    config.experiments.asyncWebAssembly = true;

    // Copy `orca_whirlpools_core_js_bindings_bg.wasm` file
    // This is only needed because of the monorepo setup
    config.plugins.push(
      new CopyWebpackPlugin({
        patterns: [{
          from: "../../core/dist/nodejs/orca_whirlpools_core_js_bindings_bg.wasm",
          to: "./server/app"
        }],
      })
    );

    // The following supresses a warning about using top-level-await
    if (!isServer) {
      config.output.environment = { ...config.output.environment, asyncFunction: true };
    }

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
