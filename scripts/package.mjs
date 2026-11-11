import { collectNotices } from "./notices.mjs";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
export function preparePackage() {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const target = resolve("../package");
  const marker = join(target, ".veltrite-package");
  if (existsSync(target) && !existsSync(marker))
    throw Error("Папка package занята: выберите другую VELTRITE_LOCAL_DIR");
  if (existsSync(marker)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(marker, "generated");
  for (const name of ["dist", "dist-electron"])
    cpSync(name, join(target, name), { recursive: true, force: true });
  const build = {
    ...manifest.build,
    electronVersion: manifest.devDependencies.electron,
    extraResources: [{ from: resolve("resources/icon.png"), to: "icon.png" }],
    npmRebuild: false,
    directories: {
      app: target,
      output: resolve("../releases"),
      buildResources: resolve("resources"),
    },
  };
  cpSync("LICENSE", join(target, "LICENSE"));
  collectNotices(join(target, "THIRD_PARTY_NOTICES.txt"));
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify(
      {
        name: manifest.name,
        productName: manifest.productName,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        main: manifest.main,
      },
      null,
      2,
    ),
  );
  writeFileSync(resolve("../builder-config.json"), JSON.stringify(build, null, 2));
  return target;
}
