// @@@ publishable staging dir - this repo deliberately has no build step: every in-repo consumer
// imports the TypeScript source through tsx. But Node refuses to strip types under node_modules,
// so a package whose `exports` points at .ts cannot be imported by anyone outside this repo.
// publishConfig does NOT override exports/files (measured: the tarball kept the src paths), so the
// only way to keep both is to publish a GENERATED directory: dev keeps src, the registry gets dist.
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(pkgRoot, ".publish");
const manifest = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8"));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(pkgRoot, "dist"), join(out, "dist"), { recursive: true });
await cp(join(pkgRoot, "templates"), join(out, "templates"), { recursive: true }).catch(() => {});

const published = {
  name: manifest.name,
  version: manifest.version,
  type: manifest.type,
  description: manifest.description,
  engines: manifest.engines,
  // Zero runtime dependencies is the whole point of this package; carry that forward verbatim.
  dependencies: manifest.dependencies ?? {},
  files: ["dist", "templates"],
  types: "./dist/index.d.ts",
  exports: {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./graph-delta": {
      types: "./dist/graph-delta.d.ts",
      default: "./dist/graph-delta.js",
    },
    "./review": { types: "./dist/review/index.d.ts", default: "./dist/review/index.js" },
    "./identity": { types: "./dist/identity-presets.d.ts", default: "./dist/identity-presets.js" },
  },
};
await writeFile(join(out, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
console.log(`staged ${published.name}@${published.version} -> ${out}`);
