import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const directory = resolve(process.argv[2] || "../Veltrite-local/releases");
const lines = readdirSync(directory)
  .filter((name) => /\.(dmg|exe|zip)$/.test(name))
  .sort()
  .map(
    (name) =>
      createHash("sha256")
        .update(readFileSync(join(directory, name)))
        .digest("hex") +
      "  " +
      name,
  );
if (!lines.length) throw Error("Установщики не найдены");
writeFileSync(join(directory, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log("Созданы контрольные суммы: " + lines.length);
