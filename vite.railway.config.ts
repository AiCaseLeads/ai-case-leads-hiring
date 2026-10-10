import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vinext from "vinext";

// A separate build graph: no Sites dispatcher, mock identity, or Workers plugin.
export default defineConfig({
  plugins: [vinext({ nextConfig: {}, precompress: true })],
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./lib/railway/bindings.ts", import.meta.url)) } },
  define: { "process.env.HOSTING_PLATFORM": JSON.stringify("railway") },
});
