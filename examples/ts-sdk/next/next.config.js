import NextBundleAnalyzer from "@next/bundle-analyzer";
import CopyWebpackPlugin from "copy-webpack-plugin";
import fs from "fs";
import path from "path";

const nextConfig = {
  serverExternalPackages: ["@orca-so/whirlpools-core"],
  webpack(config, { isServer }) {
    config.experiments.asyncWebAssembly = true;

    // Copy `orca_whirlpools_core_js_bindings_bg.wasm` file
    // Try node_modules first (for npm installed package), fallback to relative path (for monorepo)
    const nodeModulesWasmPath = "node_modules/@orca-so/whirlpools-core/dist/nodejs/orca_whirlpools_core_js_bindings_bg.wasm";
    const relativeWasmPath = "../../../ts-sdk/core/dist/nodejs/orca_whirlpools_core_js_bindings_bg.wasm";

    let wasmPath;
    if (fs.existsSync(path.resolve(nodeModulesWasmPath))) {
      wasmPath = nodeModulesWasmPath;
    } else if (fs.existsSync(path.resolve(relativeWasmPath))) {
      wasmPath = relativeWasmPath;
    } else {
      throw new Error("Could not find orca_whirlpools_core_js_bindings_bg.wasm file");
    }

    config.plugins.push(
      new CopyWebpackPlugin({
        patterns: [
          {
            from: wasmPath,
            to: "./server/app/swap",
          },
          {
            from: wasmPath,
            to: "./server/app",
          },
        ],
      }),
    );

    // The following supresses a warning about using top-level-await and is optional
    if (!isServer) {
      config.output.environment = {
        ...config.output.environment,
        asyncFunction: true,
      };
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
