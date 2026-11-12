import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, newRecoveryKey, parseRecoveryKey } from "../electron/crypto";
import { importFolder } from "../electron/importer";
import { mergeSnapshots } from "../electron/merge";
import { relativePath, safePath } from "../electron/paths";
import { Vault, hash } from "../electron/vault";
import { frontmatter, indexNote, resolveLink, validateCanvas } from "../shared/markdown";
import type { Snapshot } from "../shared/types";
let temp: string;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-unit-"));
});
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});
const snapshot = (values: Record<string, string>): Snapshot =>
  Object.fromEntries(
    Object.entries(values).map(([p, s]) => [
      p,
      { hash: hash(s), content: Buffer.from(s).toString("base64") },
    ]),
  );
describe("Переносимые пути и границы хранилища", () => {
  it.each([
    "../secret",
    "/etc/passwd",
    "a/../../b",
    "a\\b",
    "a//b",
    ".git/config",
    "CON.md",
    "a/NUL.txt",
    "a:b",
    "a.",
    "a ",
  ])("отклоняет %s", (value) => {
    expect(() => relativePath(value)).toThrow();
  });
  it("поддерживает кириллицу и вложенные папки", () =>
    expect(relativePath("Учёба/Линейная алгебра.md")).toBe("Учёба/Линейная алгебра.md"));
  it("отклоняет символические ссылки за пределы папки", async () => {
    const root = path.join(temp, "root");
    await fs.mkdir(root);
    await fs.symlink(temp, path.join(root, "outside"), "junction");
    await expect(safePath(root, "outside/data.md")).rejects.toThrow("Символические");
  });
});
describe("Шифрование", () => {
  it("шифрует с новым nonce и восстанавливает содержимое", () => {
    const key = parseRecoveryKey(newRecoveryKey()),
      input = Buffer.from("Русский текст\n秘密");
    const a = encrypt(input, key, "repo/1"),
      b = encrypt(input, key, "repo/1");
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, key, "repo/1").equals(input)).toBe(true);
    expect(a.includes(input)).toBe(false);
  });
  it("не принимает подмену данных, ключа или репозитория", () => {
    const key = parseRecoveryKey(newRecoveryKey()),
      encrypted = encrypt(Buffer.from("notes"), key, "repo/1");
    const bad = Buffer.from(encrypted);
    bad[bad.length - 20] ^= 1;
    expect(() => decrypt(bad, key, "repo/1")).toThrow();
    expect(() => decrypt(encrypted, key, "repo/2")).toThrow();
    expect(() =>
      decrypt(encrypted, parseRecoveryKey(newRecoveryKey()), "repo/1"),
    ).toThrow();
  });
  it("не принимает токен или пароль за ключ", () => {
    expect(() => parseRecoveryKey("password")).toThrow();
  });
});
describe("Трёхстороннее объединение", () => {
  it("объединяет независимые офлайн-изменения", () => {
    const base = snapshot({ "one.md": "old", "two.md": "old" }),
      a = snapshot({ "one.md": "Mac", "two.md": "old" }),
      b = snapshot({ "one.md": "old", "two.md": "Windows" });
    const result = mergeSnapshots(base, a, b);
    expect(result.conflicts).toEqual([]);
    expect(result.files["one.md"].hash).toBe(hash("Mac"));
    expect(result.files["two.md"].hash).toBe(hash("Windows"));
  });
  it("сохраняет обе конфликтующие версии", () => {
    const result = mergeSnapshots(
      snapshot({ "a.md": "old" }),
      snapshot({ "a.md": "mac" }),
      snapshot({ "a.md": "win" }),
    );
    expect(result.conflicts).toEqual(["a.md"]);
    expect(Object.keys(result.files)).toHaveLength(2);
    expect(
      Object.values(result.files)
        .map((v) => Buffer.from(v.content, "base64").toString())
        .sort(),
    ).toEqual(["mac", "win"]);
  });
  it("передаёт удаление и сохраняет изменение, конфликтующее с удалением", () => {
    expect(
      mergeSnapshots(snapshot({ "a.md": "old" }), {}, snapshot({ "a.md": "old" })).files,
    ).toEqual({});
    const result = mergeSnapshots(
      snapshot({ "a.md": "old" }),
      snapshot({ "a.md": "changed" }),
      {},
    );
    expect(result.conflicts).toEqual(["a.md"]);
    expect(Object.values(result.files)[0].hash).toBe(hash("changed"));
  });
  it("не удаляет новый локальный файл при первом подключении", () => {
    expect(
      Object.keys(
        mergeSnapshots(
          {},
          snapshot({ "local.md": "new" }),
          snapshot({ "remote.md": "cloud" }),
        ).files,
      ),
    ).toEqual(["local.md", "remote.md"]);
  });
});
describe("Файлы, история и корзина", () => {
  it("не следует ссылкам внутри служебной папки истории", async () => {
    const root = path.join(temp, "vault"),
      outside = path.join(temp, "outside");
    await fs.mkdir(root);
    await fs.mkdir(outside);
    const vault = new Vault(root);
    await vault.open();
    const note = await vault.create("note.md", "original");
    await fs.symlink(outside, path.join(root, ".veltrite", "history"), "junction");
    await expect(vault.write(note.path, "changed", note.revision)).rejects.toThrow(
      "Символические",
    );
    expect(await fs.readdir(outside)).toEqual([]);
    expect((await vault.read(note.path)).content).toBe("original");
  });
  it("исключает неизвестные настройки из синхронизации и проверяет типы", async () => {
    const first = new Vault(temp);
    await first.open();
    await fs.writeFile(
      path.join(temp, ".veltrite", "preferences.json"),
      JSON.stringify({ fontSize: 18, token: "synthetic-secret" }),
    );
    const reopened = new Vault(temp);
    await reopened.open();
    expect(reopened.preferences.fontSize).toBe(18);
    const settings = Buffer.from(
      (await reopened.snapshot())[".veltrite/shared.json"].content,
      "base64",
    ).toString();
    expect(settings).not.toContain("synthetic-secret");
    expect(settings).not.toContain("token");
    await expect(reopened.setPreferences({ autoSync: "true" } as any)).rejects.toThrow(
      "настройки",
    );
    expect(reopened.preferences.autoSync).toBe(false);
  });
  it("располагает файлы непосредственно под своей папкой", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create("Альфа/Один.md", "one");
    await vault.create("Бета/Два.md", "two");
    await vault.create("Корень.md", "root");
    expect((await vault.list()).map((file) => file.path)).toEqual([
      "Альфа",
      "Альфа/Один.md",
      "Бета",
      "Бета/Два.md",
      "Корень.md",
    ]);
  });
  it("переносит ссылки, вложения, историю и закладки при переименовании папки", async () => {
    const vault = new Vault(temp);
    await vault.open();
    const original = await vault.create("Старая/A.md", "# A");
    await vault.write(original.path, "# A\nВторая версия", original.revision);
    await fs.writeFile(path.join(temp, "Старая", "image.png"), Buffer.from([1, 2, 3]));
    await vault.create(
      "Ссылка.md",
      "[[Старая/A#A|Имя]]\n![Картинка](Старая/image.png)\n`[[Старая/A]]`\n```\n[[Старая/A]]\n```",
    );
    await vault.create(
      "Схема.canvas",
      JSON.stringify({
        nodes: [
          {
            id: "a",
            type: "file",
            file: "Старая/A.md",
            x: 0,
            y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [],
      }),
    );
    await vault.setPreferences({ bookmarks: ["Старая/A.md"] });
    await vault.rename("Старая", "Новая");
    expect((await vault.read("Ссылка.md")).content).toBe(
      "[[Новая/A#A|Имя]]\n![Картинка](%D0%9D%D0%BE%D0%B2%D0%B0%D1%8F/image.png)\n`[[Старая/A]]`\n```\n[[Старая/A]]\n```",
    );
    expect(JSON.parse((await vault.read("Схема.canvas")).content).nodes[0].file).toBe(
      "Новая/A.md",
    );
    expect((await vault.history("Новая/A.md")).length).toBeGreaterThan(0);
    expect(vault.preferences.bookmarks).toEqual(["Новая/A.md"]);
  });
  it("сохраняет правки и историю, отказывает при внешнем изменении", async () => {
    const vault = new Vault(temp);
    await vault.open();
    const first = await vault.create("Папка/Заметка.md", "первая");
    const next = await vault.write(first.path, "вторая", first.revision);
    const versions = await vault.history(first.path);
    expect(versions).toHaveLength(1);
    expect(await vault.historyRead(first.path, versions[0].id)).toBe("первая");
    await fs.writeFile(path.join(temp, first.path), "внешняя");
    await expect(vault.write(first.path, "моя", next.revision)).rejects.toThrow(
      "другой программой",
    );
    expect((await vault.read(first.path)).content).toBe("внешняя");
  });
  it("восстанавливает удалённую папку с точными байтами", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create("Папка/Текст.md", "точный текст");
    await vault.trash("Папка");
    expect((await vault.list()).filter((f) => f.kind === "note")).toHaveLength(0);
    const entries = await vault.trashList();
    await vault.restoreTrash(entries[0].id);
    expect((await vault.read("Папка/Текст.md")).content).toBe("точный текст");
  });
  it("не затирает файл с тем же именем в другом регистре", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create("First.md", "original");
    await expect(vault.create("first.md", "second")).rejects.toThrow("существует");
    expect((await vault.read("First.md")).content).toBe("original");
  });
  it("обновляет точные wiki-ссылки после переименования", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create("Старая.md", "content");
    await vault.create("Ссылка.md", "[[Старая]] и [[Старая#Раздел|псевдоним]]");
    await vault.rename("Старая.md", "Папка/Новая.md");
    expect((await vault.read("Ссылка.md")).content).toBe(
      "[[Папка/Новая]] и [[Папка/Новая#Раздел|псевдоним]]",
    );
  });
  it("не включает метаданные и историю в снимок синхронизации", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create("a.md", "text");
    await fs.mkdir(path.join(temp, ".obsidian"));
    await fs.writeFile(path.join(temp, ".obsidian", "secrets.json"), "secret");
    const snapshot = await vault.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      ".veltrite/folders.json",
      ".veltrite/shared.json",
      "a.md",
    ]);
  });
  it("останавливает применение, если файл изменился во время обмена", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create("a.md", "old");
    const original = await vault.snapshot();
    await fs.writeFile(path.join(temp, "a.md"), "external");
    await expect(
      vault.applySnapshot({ ...original, ...snapshot({ "a.md": "remote" }) }, original),
    ).rejects.toThrow("изменились");
    expect((await vault.read("a.md")).content).toBe("external");
  });
});
describe("Импорт папки", () => {
  it("копирует структуру и холсты без изменения оригинала и исполнения плагинов", async () => {
    const source = path.join(temp, "source"),
      destination = path.join(temp, "dest");
    await fs.mkdir(path.join(source, "Учёба"), { recursive: true });
    await fs.mkdir(path.join(source, ".obsidian", "plugins", "untrusted"), {
      recursive: true,
    });
    await fs.mkdir(destination);
    const note = "---\ntags: [тест]\n---\n# Пример\n[[Другая]]\n![[рисунок.png]]";
    await fs.writeFile(path.join(source, "Учёба", "Пример.md"), note);
    const canvas =
      '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100,"height":100,"text":"Идея"}],"edges":[]}';
    await fs.writeFile(path.join(source, "Схема.canvas"), canvas);
    await fs.writeFile(
      path.join(source, ".obsidian", "plugins", "untrusted", "main.js"),
      'throw new Error("must not run")',
    );
    await fs.writeFile(path.join(source, "рисунок.png"), Buffer.from([0, 1, 2, 255]));
    const before = await fs.readFile(path.join(source, "Учёба", "Пример.md"));
    const result = await importFolder(source, destination);
    expect(result.imported).toBe(3);
    expect(await fs.readFile(path.join(destination, "Учёба", "Пример.md"))).toEqual(
      before,
    );
    expect(await fs.readFile(path.join(source, "Учёба", "Пример.md"))).toEqual(before);
    expect(await fs.readFile(path.join(destination, "Схема.canvas"), "utf8")).toBe(
      canvas,
    );
    expect(result.warnings.join(" ")).toContain("плагин");
  });
  it("отказывает при импорте внутрь исходника и в непустую папку", async () => {
    await fs.mkdir(path.join(temp, "child"));
    await expect(importFolder(temp, path.join(temp, "child"))).rejects.toThrow("друг");
  });
});
describe("Индекс и открытые форматы", () => {
  it("ищет YAML-теги, вложенные теги и путь с пробелами", async () => {
    const vault = new Vault(temp);
    await vault.open();
    await vault.create(
      "Мои проекты/Дело.md",
      "---\ntags: [проект/личный]\n---\n# Задача\nСделать сегодня",
    );
    expect((await vault.search('tag:проект path:"Мои проекты"'))[0].path).toBe(
      "Мои проекты/Дело.md",
    );
    expect(await vault.search("-tag:проект")).toEqual([]);
  });
  it("не допускает циклические YAML-свойства в интерфейс", () => {
    const text = "---\na: &a\n  nested: *a\n---\n# Текст";
    expect(() => JSON.stringify(frontmatter(text).properties)).not.toThrow();
    expect(frontmatter(text).body).toContain("# Текст");
  });
  it("извлекает свойства, теги, псевдонимы, заголовки и ссылки", () => {
    const note = indexNote(
      "Папка/a.md",
      "---\naliases: [Альфа]\ntags: [учёба]\nstatus: draft\n---\n# Заголовок\n[[Бета|текст]] #проект/идея\n```\n[[не ссылка]]\n```",
    );
    expect(note.aliases).toEqual(["Альфа"]);
    expect(note.tags).toContain("проект/идея");
    expect(note.links).toEqual(["Бета"]);
    expect(note.headings[0].text).toBe("Заголовок");
    expect(note.properties.status).toBe("draft");
  });
  it("разрешает псевдонимы и относительные ссылки", () => {
    const index = [indexNote("Папка/a.md", "---\naliases: [Альфа]\n---\n# A")];
    expect(resolveLink("Альфа", "b.md", ["Папка/a.md"], index)).toBe("Папка/a.md");
    expect(resolveLink("a", "Папка/b.md", ["Папка/a.md"], index)).toBe("Папка/a.md");
  });
  it("принимает пустой JSON Canvas и отвергает повреждённые узлы", () => {
    expect(validateCanvas({})).toEqual({ nodes: [], edges: [] });
    expect(() =>
      validateCanvas({
        nodes: [{ id: "x", type: "text", x: NaN, y: 0, width: 2, height: 2 }],
        edges: [],
      }),
    ).toThrow();
  });
});

it("кэш индекса и поиска видит внешнюю правку, удаление и переименование", async () => {
  const root = path.join(temp, "cache");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "Один.md"), "# Старое\nУникальный старый текст");
  const vault = new Vault(root);
  await vault.open();
  await vault.index();
  expect((await vault.search("Уникальный")).map((note) => note.path)).toEqual([
    "Один.md",
  ]);
  await fs.writeFile(
    path.join(root, "Один.md"),
    "# Новое\nДругой новый текст, другая длина",
  );
  expect((await vault.search("Другой")).map((note) => note.path)).toEqual(["Один.md"]);
  expect(await vault.search("Уникальный")).toEqual([]);
  await vault.rename("Один.md", "Два.md");
  expect((await vault.search("Другой")).map((note) => note.path)).toEqual(["Два.md"]);
  await vault.trash("Два.md");
  expect(await vault.search("Другой")).toEqual([]);
});

it("старый основной акцент заменяется медным, выбранный пользователем цвет сохраняется", async () => {
  const root = path.join(temp, "appearance");
  await fs.mkdir(root);
  const vault = new Vault(root);
  await vault.open();
  await vault.setPreferences({ accent: "#c0603a" });
  const updated = new Vault(root);
  expect((await updated.open()).preferences.accent).toBe("#b99871");
  await updated.setPreferences({ accent: "#74805a" });
  expect((await new Vault(root).open()).preferences.accent).toBe("#74805a");
});
