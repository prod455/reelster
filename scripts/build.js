// Packs src/ into dist/reelster-<version>.zip, ready for the Chrome Web Store
// or "Load unpacked". Fails if manifest and package versions drift apart.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
if (pkg.version !== manifest.version) {
  throw new Error(`version mismatch: package.json ${pkg.version} vs manifest.json ${manifest.version}`);
}

const out = `dist/reelster-${pkg.version}.zip`;
mkdirSync("dist", { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-X", `../${out}`, "."], { cwd: "src", stdio: "inherit" });
console.log(`built ${out}`);
