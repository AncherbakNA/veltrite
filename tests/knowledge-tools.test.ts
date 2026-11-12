import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { composeNotes } from "../electron/composer";
import { importFolder } from "../electron/importer";
import { linkMention, unlinkedMentions } from "../electron/mentions";
import { updateProperties } from "../electron/metadata";
import { mergePreferences } from "../electron/preferences";
import { StyleStore } from "../electron/styles";
import { Vault } from "../electron/vault";
import {
  allBookmarks,
  moveBookmark,
  normalizeBookmarks,
  type Bookmark,
} from "../shared/bookmarks";
import { editorAction } from "../shared/editor-actions";
import { editFrontmatter } from "../shared/frontmatter-edit";
import { buildGraph } from "../shared/graph";
import { defaultGraphOptions } from "../shared/graph-options";
import { effectiveHotkeys, eventShortcut, normalizeShortcut } from "../shared/hotkeys";
import { importLayout } from "../shared/import-layout";
import { importHotkeys, importPropertyTypes } from "../shared/import-preferences";
import { folderFile } from "../shared/links";
import { frontmatter, indexNote } from "../shared/markdown";
import { noteHeadings } from "../shared/markdown-blocks";
import { maskMarkdownComments } from "../shared/markdown-comments";
import { findMentions } from "../shared/mentions";
import { leaves } from "../shared/panes";
import { parseSearch, searchDocuments } from "../shared/search";
import { splitSlides } from "../shared/slides";
import { formatDate, renderTemplate } from "../shared/templates";
import { defaultPreferences } from "../shared/types";
let temp: string, vault: Vault;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-tools-"));
  vault = new Vault(temp);
  await vault.open();
});
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

test("закладки мигрируют без потерь, группа не перемещается внутрь себя, переименование обновляет фрагменты", async () => {
  let prefs = mergePreferences(defaultPreferences, { bookmarks: ["Папка/Заметка.md"] });
  const group: Bookmark = {
    id: "g",
    type: "group",
    title: "Работа",
    children: [
      {
        id: "h",
        type: "file",
        title: "План",
        path: "Папка/Заметка.md",
        fragment: "план",
      },
    ],
  };
  prefs = mergePreferences(prefs, { bookmarkItems: [...prefs.bookmarkItems, group] });
  prefs = mergePreferences(prefs, { bookmarks: [] });
  expect(prefs.bookmarkItems).toEqual([group]);
  expect(moveBookmark([group], "g", "g")).toEqual([group]);
  expect(moveBookmark([group], "h", null)[1].id).toBe("h");
  expect(() =>
    normalizeBookmarks([{ ...group, children: [{ ...group, children: [] }] }]),
  ).toThrow();
  expect(() =>
    normalizeBookmarks([
      { id: "url", title: "", type: "url", url: "javascript:alert(1)" },
    ]),
  ).toThrow();
  await vault.create("Папка/Заметка.md", "# План");
  await vault.setPreferences(prefs);
  await vault.rename("Папка", "Архив");
  expect(allBookmarks(vault.preferences.bookmarkItems)).toContainEqual({
    id: "h",
    type: "file",
    title: "План",
    path: "Архив/Заметка.md",
    fragment: "план",
  });
});
test("упоминания учитывают Unicode и псевдонимы, исключают код, свойства, ссылки и части слов", async () => {
  const text =
    "---\nalias: Москва\n---\nМосковская Москва. `Москва` [[Москва]] [Москва](x.md)\n```text\nМосква\n```\n%%Москва%%\n";
  expect(findMentions(text, ["Москва"]).map((item) => item.text)).toEqual(["Москва"]);
  await vault.create("Город.md", "---\naliases: [Москва]\n---\n# Город");
  await vault.create("Планы.md", "Посетить Москва, потом Город.");
  const mentions = await unlinkedMentions(vault, "Город.md");
  expect(mentions.incoming).toHaveLength(2);
  await linkMention(vault, mentions.incoming[0]);
  expect((await vault.read("Планы.md")).content).toContain("[Москва]");
  await expect(linkMention(vault, mentions.incoming[1])).rejects.toThrow("изменился");
});
test("извлечение заменяет точный диапазон и переносит относительные ссылки", async () => {
  await vault.create("Вход/Другая.md", "# Другая");
  const source = await vault.create(
    "Вход/Источник.md",
    "Начало. Текст [[Другая]] и [ссылка](Другая.md). Конец.",
  );
  const from = source.content.indexOf("Текст"),
    to = source.content.indexOf(" Конец");
  await composeNotes(vault, {
    operation: "extract",
    source: source.path,
    sourceRevision: source.revision,
    target: "Выход/Фрагмент.md",
    from,
    to,
    placement: "append",
    replacement: "embed",
  });
  expect((await vault.read(source.path)).content).toBe(
    "Начало. ![[../%D0%92%D1%8B%D1%85%D0%BE%D0%B4/%D0%A4%D1%80%D0%B0%D0%B3%D0%BC%D0%B5%D0%BD%D1%82.md]] Конец.",
  );
  expect((await vault.read("Выход/Фрагмент.md")).content).toContain("[[Вход/Другая]]");
  expect((await vault.read("Выход/Фрагмент.md")).content).toContain(
    "../%D0%92%D1%85%D0%BE%D0%B4/",
  );
});
test("объединение сохраняет YAML и комментарии, обновляет обратные ссылки, оригинал доступен в корзине", async () => {
  const source = await vault.create(
    "Источник.md",
    "---\ntags: [один]\nstatus: done\n---\n# Текст\n\nСодержимое",
  );
  const target = await vault.create(
    "Цель.md",
    "---\n# важный комментарий\ntags: [два]\nstatus: active\n---\n# Цель\n",
  );
  await vault.create("Ссылка.md", "[[Источник#Текст]] и [источник](Источник.md)");
  await composeNotes(vault, {
    operation: "merge",
    source: source.path,
    sourceRevision: source.revision,
    target: target.path,
    targetRevision: target.revision,
    placement: "append",
    replacement: "none",
  });
  const content = (await vault.read(target.path)).content;
  expect(content).toContain("# важный комментарий");
  expect(frontmatter(content).properties).toMatchObject({
    tags: ["два", "один"],
    status: "active",
    status_из_источника: "done",
  });
  expect((await vault.read("Ссылка.md")).content).toContain("[[Цель#Текст]]");
  expect((await vault.trashList()).some((item) => item.path === source.path)).toBe(true);
});
test("частичная ошибка откатывает уже записанную цель, внешняя версия источника остаётся целой", async () => {
  const source = await vault.create("Источник.md", "# Источник\nТекст"),
    target = await vault.create("Цель.md", "# Цель");
  const write = vault.write.bind(vault);
  vi.spyOn(vault, "write").mockImplementation(async (file, content, revision) => {
    if (file === source.path) throw Error("Тестовый отказ записи");
    return write(file, content, revision);
  });
  await expect(
    composeNotes(vault, {
      operation: "extract",
      source: source.path,
      sourceRevision: source.revision,
      target: target.path,
      targetRevision: target.revision,
      from: 11,
      to: source.content.length,
      placement: "append",
      replacement: "link",
    }),
  ).rejects.toThrow("отказ");
  expect((await vault.read(target.path)).content).toBe(target.content);
  expect((await vault.read(source.path)).content).toBe(source.content);
});
test("массовое переименование свойств сохраняет комментарии и останавливается до записи при коллизии", async () => {
  const content =
    "---\n# комментарий\nstatus: active # inline\nlist: [один, два]\n---\nТекст";
  expect(editFrontmatter(content, { rename: { from: "status", to: "state" } })).toContain(
    "state: active # inline",
  );
  await vault.create("Один.md", content);
  await vault.create("Два.md", "---\nstatus: done\nstate: old\n---\nТекст");
  await expect(
    updateProperties(vault, ["Один.md", "Два.md"], {
      rename: { from: "status", to: "state" },
    }),
  ).rejects.toThrow("уже существует");
  expect((await vault.read("Один.md")).content).toBe(content);
  await updateProperties(vault, ["Один.md"], { remove: ["list"] });
  expect((await vault.read("Один.md")).content).toContain("# комментарий");
  expect(() => editFrontmatter("---\nне закрыто", { set: { a: 1 } })).toThrow(
    "незакрытый",
  );
});
test("шаблоны используют локальную дату, ISO-недели и буквальный текст", () => {
  const date = new Date(2021, 0, 1, 9, 5, 7);
  expect(formatDate(date, "YYYY-MM-DD HH:mm:ss")).toBe("2021-01-01 09:05:07");
  expect(formatDate(date, "GGGG/[Неделя] WW")).toBe("2020/Неделя 53");
  expect(
    renderTemplate("# {{title}}\n{{date:DD.MM.YYYY}} {{time}}", { title: "День", date }),
  ).toBe("# День\n01.01.2021 09:05");
});
test("форматирование сохраняет диапазон для отмены, задачи переключаются без потери отступа", () => {
  expect(editorAction("Текст", 0, 5, "bold")).toMatchObject({
    insert: "**Текст**",
    anchor: 2,
    head: 7,
  });
  expect(editorAction("**Текст**", 2, 7, "bold")).toMatchObject({
    from: 0,
    to: 9,
    insert: "Текст",
  });
  expect(editorAction("  - [ ] Дело", 5, 5, "task").insert).toBe("  - [x] Дело");
  expect(editorAction("  - [x] Дело", 5, 5, "task").insert).toBe("  - [ ] Дело");
});
test("клавиши работают по физическому коду и допускают отключение стандартной команды", () => {
  expect(
    eventShortcut(
      { code: "KeyB", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
      true,
    ),
  ).toBe("Mod+KeyB");
  expect(normalizeShortcut("Shift+Mod+KeyP")).toBe("Mod+Shift+KeyP");
  expect(() => normalizeShortcut("Mod+KeyC")).toThrow("системой");
  expect(effectiveHotkeys({ "new-note": [] })["new-note"]).toEqual([]);
});
test("локальный граф учитывает глубину и направление, группы используют язык поиска", () => {
  const notes = [
    indexNote("А.md", "[[Б]] #проект"),
    indexNote("Б.md", "[[В]]"),
    indexNote("В.md", "Текст"),
    indexNote("Один.md", "Текст"),
  ];
  const graph = buildGraph(notes, "", true, "А.md", {
    ...defaultGraphOptions,
    depth: 2,
    direction: "outgoing",
    groups: [{ query: "tag:проект", color: "#123456" }],
  });
  expect(graph.nodes.map((node) => node.path)).toEqual(["А.md", "Б.md", "В.md"]);
  expect(graph.nodes[0].color).toBe("#123456");
  expect(buildGraph(notes, "path:Б", false, null).nodes.map((node) => node.path)).toEqual(
    ["Б.md"],
  );
});
test("поиск в строке, блоке, разделе и задачах не смешивает разные области", () => {
  const text =
    "# Работа\n\nодин\nдва\n\nтри\n\n## Задачи\n- [ ] купить хлеб\n- [x] купить кофе\n";
  const documents = [{ text, note: indexNote("Работа.md", text) }];
  const search = (query: string) => searchDocuments(documents, parseSearch(query)!);
  expect(search("line:(один два)")).toEqual([]);
  expect(search("block:(один два)")[0].line).toBe(3);
  expect(search("block:(один три)")).toEqual([]);
  expect(search("section:(один три)")[0].line).toBe(1);
  expect(search("task-todo:хлеб")[0].line).toBe(9);
  expect(search("task-todo:кофе")).toEqual([]);
  expect(search("task-done:(купить кофе)")[0].line).toBe(10);
});
test("импорт переносит закладки, открытые панели, форматы дат и корневые папки", async () => {
  const source = path.join(temp, "source"),
    destination = path.join(temp, "destination");
  await fs.mkdir(path.join(source, ".obsidian"), { recursive: true });
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, "Один.md"), "# Раздел");
  await fs.writeFile(path.join(source, "Два.md"), "# Два");
  const config = (name: string, value: unknown) =>
    fs.writeFile(path.join(source, ".obsidian", name), JSON.stringify(value));
  await config("daily-notes.json", {
    folder: "",
    format: "YYYY/MM-DD",
    template: "Два",
    autorun: true,
  });
  await config("app.json", { attachmentFolderPath: "./Вложения", spellcheck: false });
  await config("bookmarks.json", {
    items: [
      {
        type: "group",
        title: "Работа",
        items: [{ type: "file", path: "Один.md", subpath: "#Раздел" }],
      },
    ],
  });
  await config("workspace.json", {
    main: {
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "tabs",
          children: [
            {
              type: "leaf",
              id: "a",
              state: { type: "markdown", state: { file: "Один.md", mode: "preview" } },
            },
          ],
        },
        {
          type: "tabs",
          children: [
            {
              type: "leaf",
              id: "b",
              state: { type: "markdown", state: { file: "Два.md", source: true } },
            },
          ],
        },
      ],
    },
    active: "b",
  });
  await config("types.json", {
    types: { price: "number", due: "date", people: "multitext", tags: "tags" },
  });
  await config("hotkeys.json", {
    "command-palette:open": [{ modifiers: ["Mod", "Shift"], key: "p" }],
  });
  await config("appearance.json", {
    theme: "moonstone",
    cssTheme: "Книга",
    enabledCssSnippets: ["Поля"],
  });
  await fs.mkdir(path.join(source, ".obsidian/themes/Книга"), { recursive: true });
  await fs.mkdir(path.join(source, ".obsidian/snippets"));
  await fs.writeFile(
    path.join(source, ".obsidian/themes/Книга/theme.css"),
    "body.theme-light { --background-primary: #f5f1e8; }",
  );
  await fs.writeFile(
    path.join(source, ".obsidian/snippets/Поля.css"),
    ".markdown { line-height:1.8; }",
  );
  const styles = new StyleStore(path.join(temp, "styles")),
    result = await importFolder(source, destination, styles);
  expect(result.vault.preferences.hotkeys.commands).toEqual(["Mod+Shift+KeyP"]);
  expect(result.vault.preferences.propertyTypes).toMatchObject({
    price: "number",
    due: "date",
    people: "list",
    tags: "tags",
  });
  expect((await styles.list()).map((style) => style.name).sort()).toEqual([
    "Книга",
    "Поля",
  ]);
  expect(result.vault.preferences.cssTheme).toBeTruthy();
  expect(result.vault.preferences.cssSnippets).toHaveLength(1);
  expect(result.vault.preferences).toMatchObject({
    dailyFolder: "",
    dailyFormat: "YYYY/MM-DD",
    dailyTemplate: "Два.md",
    dailyOpenOnStartup: true,
    attachmentFolder: "./Вложения",
    spellcheck: false,
  });
  expect(allBookmarks(result.vault.preferences.bookmarkItems)).toContainEqual(
    expect.objectContaining({ type: "file", path: "Один.md", fragment: "Раздел" }),
  );
  expect(result.session?.tabs).toEqual(["Один.md", "Два.md"]);
  expect(result.session?.active).toBe("Два.md");
  expect(folderFile("./Вложения", "Файл.png", "Работа/Заметка.md")).toBe(
    "Работа/Вложения/Файл.png",
  );
  expect(folderFile("", "День.md")).toBe("День.md");
});

test("перенос горячих клавиш и типов не принимает неизвестные команды и системные сочетания", () => {
  const result = importHotkeys({
    "editor:save-file": [{ modifiers: ["Mod"], key: "q" }],
    "editor:toggle-bold": [{ modifiers: ["Mod"], key: "b" }],
    "switcher:open": [],
    "unknown:action": [{ modifiers: ["Mod"], key: "r" }],
  });
  expect(result.hotkeys).toEqual({ "editor-bold": ["Mod+KeyB"], "quick-open": [] });
  expect(result.skipped).toBe(2);
  expect(
    importPropertyTypes({
      "bad\nname": "text",
      constructor: "text",
      tags: "multitext",
      due: "date",
    }),
  ).toEqual({ tags: "tags", due: "date" });
});
test("перенос шестнадцати соседних панелей сохраняет вкладки и допустимую глубину", () => {
  const names = Array.from({ length: 16 }, (_, i) => `N${i}.md`),
    result = importLayout(
      {
        main: {
          type: "split",
          direction: "vertical",
          children: names.map((file) => ({
            type: "tabs",
            children: [{ type: "leaf", state: { type: "markdown", state: { file } } }],
          })),
        },
      },
      new Set(names),
    );
  expect(result?.tabs).toEqual(names);
  expect(leaves(result!.layout!)).toHaveLength(16);
});

test("многострочные комментарии скрывают ссылки и заголовки, сохраняя позиции исходного текста", () => {
  const source =
    "# Видимый\n\n%% комментарий\n\n# Скрытый\n[[Секрет]]\n%%\n\n- [ ] Проверить\n\n`%% буквальный %%`\n\n```md\n%% код %%\n```";
  const masked = maskMarkdownComments(source);
  expect(masked.length).toBe(source.length);
  expect(masked.indexOf("- [ ]")).toBe(source.indexOf("- [ ]"));
  expect(masked).not.toContain("Секрет");
  expect(masked).toContain("%% буквальный %%");
  expect(masked).toContain("%% код %%");
  expect(noteHeadings(source).map((heading) => heading.text)).toEqual(["Видимый"]);
  expect(indexNote("N.md", source).links).toEqual([]);
});

test.each(["append", "prepend"] as const)(
  "объединение %s сохраняет адреса повторяющихся заголовков, блоков, холстов и закладок",
  async (placement) => {
    const source = await vault.create(
        "Источник.md",
        "# Раздел\n\nИз источника ^block\n\n[[#Раздел]] и [[#^block]]\n",
      ),
      target = await vault.create("Цель.md", "# Раздел\n\nВ цели ^block\n");
    await vault.create(
      "Ссылки.md",
      "[[Источник#Раздел]] и [[Источник#^block]]\n[[Цель#Раздел]] и [[Цель#^block]]",
    );
    await vault.create(
      "Схема.canvas",
      JSON.stringify({
        nodes: [
          {
            id: "a",
            type: "file",
            file: source.path,
            subpath: "#Раздел",
            x: 0,
            y: 0,
            width: 200,
            height: 100,
          },
          {
            id: "b",
            type: "text",
            text: "[[Источник#^block]]",
            x: 0,
            y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [],
        custom: "keep",
      }),
    );
    await vault.setPreferences({
      bookmarkItems: [
        {
          id: "source-anchor",
          type: "file",
          path: source.path,
          fragment: "Раздел",
          title: "",
        },
      ],
    });
    await composeNotes(vault, {
      operation: "merge",
      source: source.path,
      sourceRevision: source.revision,
      target: target.path,
      targetRevision: target.revision,
      placement,
      replacement: "none",
    });
    const text = (await vault.read(target.path)).content,
      links = (await vault.read("Ссылки.md")).content,
      canvas = JSON.parse((await vault.read("Схема.canvas")).content);
    expect(text).toContain("# Раздел (2)");
    expect(text).toContain("Из источника ^block-2");
    expect(text).toContain("[[#раздел-(2)]]");
    expect(links).toContain("[[Цель#раздел-(2)]]");
    expect(links).toContain("[[Цель#^block-2]]");
    expect(links).toContain("[[Цель#Раздел]]");
    expect(canvas.nodes[0]).toMatchObject({ file: target.path, subpath: "#раздел-(2)" });
    expect(canvas.nodes[1].text).toContain("Цель#^block-2");
    expect(canvas.custom).toBe("keep");
    expect(vault.preferences.bookmarkItems[0]).toMatchObject({
      path: target.path,
      fragment: "раздел-(2)",
    });
  },
);
test("извлечение переносит только адреса выбранных разделов, остальные локальные ссылки ведут к источнику", async () => {
  const source = await vault.create(
      "Вход/Источник.md",
      "# Осталось\n\nСодержание.\n\n# Выбрано\n\n[[#Осталось]] и [[#Выбрано]]\n",
    ),
    from = source.content.indexOf("# Выбрано");
  await vault.create(
    "Ссылки.md",
    "[[Вход/Источник#Осталось]] и [[Вход/Источник#Выбрано]]",
  );
  await composeNotes(vault, {
    operation: "extract",
    source: source.path,
    sourceRevision: source.revision,
    target: "Выход/Новое.md",
    from,
    to: source.content.length,
    placement: "append",
    replacement: "link",
  });
  expect((await vault.read("Ссылки.md")).content).toContain("[[Вход/Источник#Осталось]]");
  expect((await vault.read("Ссылки.md")).content).toContain("Выход/Новое#Выбрано");
  const moved = (await vault.read("Выход/Новое.md")).content;
  expect(moved).toContain("[[Вход/Источник#Осталось]]");
  expect(moved).toContain("[[#Выбрано]]");
});
test("слайды не разделяют YAML, комментарии и разделители в блоках кода", () => {
  expect(
    splitSlides("# Первый\n\n```md\n---\n```\n\n%%\n---\n%%\n\n---\n# Второй"),
  ).toHaveLength(2);
});

test("объединение не принимает тот же файл в другой нормализации Unicode и откатывает закладки при отказе корзины", async () => {
  const source = await vault.create("Café.md", "# Одинаковый\nИсточник"),
    target = await vault.create("Target.md", "# Цель");
  await expect(
    composeNotes(vault, {
      operation: "merge",
      source: source.path,
      sourceRevision: source.revision,
      target: source.path.normalize("NFD"),
      targetRevision: source.revision,
      placement: "append",
      replacement: "none",
    }),
  ).rejects.toThrow("другую");
  await vault.setPreferences({
    bookmarkItems: [{ id: "b", type: "file", title: "", path: source.path }],
  });
  vi.spyOn(vault, "trash").mockRejectedValue(Error("Тестовый отказ корзины"));
  await expect(
    composeNotes(vault, {
      operation: "merge",
      source: source.path,
      sourceRevision: source.revision,
      target: target.path,
      targetRevision: target.revision,
      placement: "append",
      replacement: "none",
    }),
  ).rejects.toThrow("отказ");
  expect((await vault.read(source.path)).content).toBe(source.content);
  expect((await vault.read(target.path)).content).toBe(target.content);
  expect(vault.preferences.bookmarkItems[0]).toMatchObject({ path: source.path });
});
