import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { Plugins, validatePlugin } from "../electron/plugins";
const manifest = {
  id: "sample",
  name: "Пример",
  description: "Тестовое расширение",
  version: "1.0.0",
  apiVersion: 1,
  main: "main.js",
  permissions: ["vault.read", "storage"],
  commands: [{ id: "run", name: "Выполнить" }],
};
test("манифест JS расширения ограничивает API, команды и разрешения", () => {
  expect(validatePlugin(manifest).commands[0].action).toBe("execute");
  for (const patch of [
    { main: "../main.js" },
    { permissions: ["system"] },
    { id: "../escape" },
    {
      commands: [
        { id: "run", name: "A" },
        { id: "run", name: "B" },
      ],
    },
    { apiVersion: 2 },
  ])
    expect(() => validatePlugin({ ...manifest, ...patch })).toThrow();
  expect(
    validatePlugin({
      id: "legacy",
      name: "Команда",
      description: "",
      version: "1.0.0",
      commands: [{ id: "insert", name: "Вставить", action: "insert", value: "текст" }],
    }).commands[0].action,
  ).toBe("insert");
});
test("установка копирует код, требует разрешения и изолирует настройки", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-plugin-"));
  try {
    const source = path.join(root, "source"),
      store = new Plugins(path.join(root, "installed"));
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest));
    await fs.writeFile(
      path.join(source, "main.js"),
      "export default function activate(api) {}",
    );
    expect((await store.install(source)).enabled).toBe(false);
    await expect(store.toggle("sample", true)).rejects.toThrow("разрешения");
    expect((await store.toggle("sample", true, ["vault.read", "storage"])).enabled).toBe(
      true,
    );
    expect(await store.code("sample")).toContain("activate");
    await store.storage("sample", "theme", { color: "red" });
    expect(await store.storage("sample", "theme")).toEqual({ color: "red" });
    await expect(store.storage("sample", "__proto__", "bad")).rejects.toThrow();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.storage("sample", "key" + i, i)),
    );
    expect(await store.storage("sample", "key0")).toBe(0);
    expect(await store.storage("sample", "key9")).toBe(9);
    await fs.writeFile(path.join(root, "installed", "broken.json"), "not json");
    expect(await store.list()).toHaveLength(1);
    await store.install(source);
    expect((await store.get("sample")).grants).toEqual([]);
    await store.remove("sample");
    expect(await store.list()).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
