import { defineConfig } from "astro/config";

// Static-only marketing site. No SSR adapter, no islands framework: the two
// interactive behaviours (mobile menu, article filter) ship as inline vanilla
// <script> blocks in the components that own them.
export default defineConfig({
  site: "https://dave-tax-nz-site.fly.dev",
  output: "static",
  // Preserved from the Vite config so the GitHub Pages deploy keeps working.
  // Unset everywhere else (Fly/Docker), so the base resolves to "/".
  base: process.env.GITHUB_ACTIONS ? "/dave-tax-nz-redesign/" : "/",
  build: {
    // Dockerfile copies /app/dist/client, .github/workflows/deploy.yml uploads
    // dist/client, and scripts/prepare-sites-build.mjs asserts
    // dist/client/index.html. Keep the Vite output path.
    format: "directory",
  },
  outDir: "./dist/client",
  publicDir: "./public",
});
