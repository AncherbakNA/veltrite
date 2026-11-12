import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve, join, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = resolve(
  process.env.VELTRITE_LOCAL_DIR ||
    (process.env.CI && process.env.RUNNER_TEMP
      ? join(process.env.RUNNER_TEMP, "Veltrite-local")
      : join(source, "..", "Veltrite-local")),
);
const relativeLocal = relative(source, local);
if (
  !relativeLocal ||
  (!relativeLocal.startsWith(".." + sep) &&
    relativeLocal !== ".." &&
    !isAbsolute(relativeLocal))
)
  throw Error("VELTRITE_LOCAL_DIR должен находиться вне проекта");
const work = join(local, "workspace");
const markerPath = join(work, ".veltrite-workspace.json");
if (existsSync(work) && readdirSync(work).length) {
  if (!existsSync(markerPath))
    throw Error("Рабочая папка занята. Выберите отдельную VELTRITE_LOCAL_DIR");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (marker.kind !== "veltrite-development" || marker.source !== source)
    throw Error("Эта рабочая папка принадлежит другой копии проекта");
}
mkdirSync(work, { recursive: true });
writeFileSync(
  join(work, ".veltrite-workspace.json"),
  JSON.stringify({ kind: "veltrite-development", source }),
);
for (const name of [
  "electron",
  "shared",
  "sdk",
  "examples",
  "src",
  "scripts",
  "tests",
  "resources",
  "catalog",
  "docs",
  "LICENSE",
  ".prettierignore",
  ".prettierrc.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "playwright.config.ts",
]) {
  if (existsSync(join(source, name))) {
    if (statSync(join(source, name)).isDirectory())
      rmSync(join(work, name), { recursive: true, force: true });
    cpSync(join(source, name), join(work, name), { recursive: true, force: true });
  }
}
const manager = process.env.VELTRITE_PACKAGE_MANAGER || "pnpm";
const stamp = join(local, "installed-state.json");
function fingerprint() {
  const digest = createHash("sha256");
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    if (existsSync(join(source, name))) digest.update(readFileSync(join(source, name)));
  return digest.digest("hex");
}

function run(bin, args) {
  const result = spawnSync(bin, args, {
    cwd: work,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (
  !existsSync(join(work, "node_modules")) ||
  !existsSync(stamp) ||
  readFileSync(stamp, "utf8") !== fingerprint()
) {
  run(manager, process.env.CI ? ["install", "--frozen-lockfile"] : ["install"]);
}
if (existsSync(join(work, "pnpm-lock.yaml")))
  cpSync(join(work, "pnpm-lock.yaml"), join(source, "pnpm-lock.yaml"));
writeFileSync(stamp, fingerprint());
console.log(`Рабочие файлы: ${local}`);
run(process.execPath, ["scripts/tasks.mjs", process.argv[2] || "dev"]);

if (process.argv[2] === "format" && existsSync(join(source, "scripts/catalog.mjs")))
  run(process.execPath, [join(source, "scripts/catalog.mjs")]);
