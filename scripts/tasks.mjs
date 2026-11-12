import { spawn, spawnSync } from "node:child_process";
import { build } from "esbuild";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { preparePackage } from "./package.mjs";
const task = process.argv[2];
if (
  !existsSync(".veltrite-workspace.json") ||
  JSON.parse(readFileSync(".veltrite-workspace.json", "utf8")).kind !==
    "veltrite-development"
)
  throw Error(
    "Используйте scripts/workspace.mjs: рабочие файлы должны находиться вне проекта",
  );
function run(path, args = []) {
  const p = spawnSync(process.execPath, [path, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status || 1);
}
async function bundleSearch() {
  mkdirSync("dist-electron", { recursive: true });
  await build({
    entryPoints: ["electron/search-worker.ts"],
    outfile: "dist-electron/search-worker.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
  });
}
async function bundle() {
  await bundleSearch();
  mkdirSync("dist-electron", { recursive: true });
  await build({
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    define: {
      "process.env.VELTRITE_SIGNED_MAC": JSON.stringify(
        process.env.VELTRITE_SIGNED_MAC || "0",
      ),
      "process.env.VELTRITE_GITHUB_CLIENT_ID": JSON.stringify(
        process.env.VELTRITE_GITHUB_CLIENT_ID || "",
      ),
      "process.env.VELTRITE_RELEASE_REPOSITORY": JSON.stringify(
        process.env.VELTRITE_RELEASE_REPOSITORY || "",
      ),
    },
    sourcemap: false,
  });
  await build({
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: false,
  });
  await build({
    entryPoints: ["electron/plugin-preload.ts"],
    outfile: "dist-electron/plugin-preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: false,
  });
}
if (task === "check") run("node_modules/typescript/lib/tsc.js", ["--noEmit"]);
else if (task === "test") {
  await bundleSearch();
  run("node_modules/vitest/vitest.mjs", ["run"]);
} else if (task === "format") {
  run("scripts/organize.mjs");
  const marker = JSON.parse(readFileSync(".veltrite-workspace.json", "utf8"));
  run("node_modules/prettier/bin/prettier.cjs", [
    marker.source,
    "--write",
    "--ignore-unknown",
    "--ignore-path",
    resolve(marker.source, ".prettierignore"),
  ]);
} else {
  run("node_modules/vite/bin/vite.js", ["build"]);
  await bundle();
  if (task === "e2e") run("node_modules/@playwright/test/cli.js", ["test"]);
  else if (task?.startsWith("dist:")) {
    // GitHub emits absent optional secrets as empty strings; builder treats CSC_LINK="" as a file path.
    for (const key of Object.keys(process.env))
      if (/^(?:CSC_|WIN_CSC_|APPLE_)/.test(key) && !process.env[key]?.trim())
        delete process.env[key];
    const target = preparePackage(task.startsWith("dist:mac") ? "mac" : "win");
    process.env.CSC_IDENTITY_AUTO_DISCOVERY =
      process.env.VELTRITE_SIGNED_MAC === "1" ? "true" : "false";
    process.env.ELECTRON_CACHE = resolve("../cache/electron");
    process.env.ELECTRON_BUILDER_CACHE = resolve("../cache/builder");
    run("node_modules/electron-builder/out/cli/cli.js", [
      "--projectDir",
      target,
      "--config",
      resolve("../builder-config.json"),
      task.startsWith("dist:mac") ? "--mac" : "--win",
      task === "dist:mac" ? "--arm64" : "--x64",
      "--publish",
      "never",
    ]);
  } else if (task === "dev") {
    const electron = resolve("node_modules/electron/cli.js");
    const child = spawn(process.execPath, [electron, "."], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code || 0));
  }
}
