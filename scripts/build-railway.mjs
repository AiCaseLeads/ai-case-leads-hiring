import "./prepare-pdf-preview.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build, createBuilder } from "vite";

if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("node24_runtime_required");
process.env.NODE_ENV = "production";
process.env.HOSTING_PLATFORM = "railway";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
await rm(path.join(root, "dist"), { recursive: true, force: true });
await (await createBuilder({ configFile: path.join(root, "vite.railway.config.ts") })).buildApp();
await build({
  configFile: false,
  resolve: { alias: { "cloudflare:workers": path.join(root, "lib/railway/bindings.ts") } },
  define: { "process.env.HOSTING_PLATFORM": JSON.stringify("railway") },
  build: { ssr: path.join(root, "lib/railway/worker.ts"), outDir: "dist/railway", emptyOutDir: true, rolldownOptions: { output: { entryFileNames: "worker.mjs" } } },
});
