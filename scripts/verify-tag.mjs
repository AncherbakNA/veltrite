import { readFileSync } from "node:fs";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
if (process.env.GITHUB_REF_NAME !== "v" + version)
  throw Error("Тег должен совпадать с версией package.json");
console.log("Версия тега подтверждена: " + version);
