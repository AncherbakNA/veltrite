import fs from "node:fs/promises";
import { join } from "node:path";
const directory = process.env.RUNNER_TEMP;
if (!directory) throw Error("Этот скрипт предназначен для временной папки CI");
const key = join(directory, "veltrite-notary-key.p8");
if (process.argv.includes("--cleanup")) {
  await fs.rm(key, { force: true });
} else if (process.env.VELTRITE_SIGNED_MAC === "1" && process.env.APPLE_API_KEY_BASE64) {
  const bytes = Buffer.from(process.env.APPLE_API_KEY_BASE64, "base64");
  if (!bytes.toString("utf8").includes("-----BEGIN PRIVATE KEY-----"))
    throw Error("Некорректный формат ключа нотарификации");
  await fs.writeFile(key, bytes, { mode: 0o600, flag: "wx" });
  if (!process.env.GITHUB_ENV || /[\r\n]/.test(key))
    throw Error("Не найден файл окружения CI");
  await fs.appendFile(process.env.GITHUB_ENV, `APPLE_API_KEY=${key}\n`);
}
