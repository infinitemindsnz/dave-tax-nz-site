import { defineConfig } from "astro/config";

// Static-only marketing site. No SSR adapter, no islands framework: the two
// interactive behaviours (mobile menu, article filter) ship as inline vanilla
// <script> blocks in the components that own them.
export default defineConfig({
  site: "https://dave-tax-nz-site.vercel.app",
  output: "static",
  // The site has one canonical generated Vercel origin and always serves from
  // the root. Preview and production builds therefore share the same base.
  base: "/",
  build: {
    // Vercel publishes dist/client, and scripts/prepare-sites-build.mjs also
    // packages the same build for a local Sites handoff.
    format: "directory",
  },
  outDir: "./dist/client",
  publicDir: "./public",
});
