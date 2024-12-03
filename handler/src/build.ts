import * as esbuild from "esbuild";

await esbuild.build({
  bundle: true,
  platform: "node",
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  external: ["node:*", "@aws-sdk/client-s3"],
  charset: "utf8",
  format: "esm",
  mainFields: ["module"],
  packages: "bundle",
  minify: !!process.env.CI,
  treeShaking: !!process.env.CI,
  target: ["node20"],
  sourcemap: process.env.CI ? "external" : "inline",
});
