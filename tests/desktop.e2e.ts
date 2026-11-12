import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
let application: ElectronApplication, page: Page, temp: string, root: string;
const modifier = process.platform === "darwin" ? "Meta" : "Control";
async function launch() {
  application = await electron.launch({
    args: process.env.VELTRITE_EXECUTABLE ? [] : ["."],
    executablePath: process.env.VELTRITE_EXECUTABLE,
    cwd: process.cwd(),
    env: {
      ...process.env,
      VELTRITE_TEST_MODE: "1",
      VELTRITE_TEST_DATA: path.join(temp, "profile"),
      VELTRITE_TEST_VAULT: root,
    },
  });
  page = await application.firstWindow();
  await page.waitForSelector(".sidebar");
}
test.beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-desktop-"));
  root = path.join(temp, "vault");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "Начало.md"),
    "---\ntags: [начало]\nstatus: active\n---\n# Место для ваших мыслей\n\nТекст заметки и [[Вторая]] связь.\n\n## План\n- [ ] Написать идею\n\n$$E=mc^2$$\n",
  );
  await fs.writeFile(path.join(root, "Вторая.md"), "# Вторая\n\nСвязь на [[Начало]].");
  await launch();
});
test.afterEach(async () => {
  await application?.close();
  await fs.rm(temp, { recursive: true, force: true });
});
test("повреждённый холст или база доступны как исходный текст", async () => {
  const broken =
    '{ "nodes": [{"id":"a","type":"file","x":0,"y":0,"width":200,"height":200}],"edges":[] }';
  await fs.writeFile(path.join(root, "Повреждённый.canvas"), broken);
  await fs.writeFile(path.join(root, "Повреждённая.base"), "views: [null]");
  await page.locator(".tree-file").filter({ hasText: "Повреждённый" }).click();
  await expect(page.locator(".canvas-error")).toBeVisible();
  expect(await fs.readFile(path.join(root, "Повреждённый.canvas"), "utf8")).toBe(broken);
  await page.locator(".tree-file").filter({ hasText: "Повреждённая" }).click();
  await page.getByRole("button", { name: "Открыть исходный код", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("views: [null]");
});
test("slash-команда и конфликт внешнего редактора сохраняют пользовательскую правку", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type("\n/");
  await expect(page.getByRole("dialog", { name: "Палитра команд" })).toBeVisible();
  await page.getByPlaceholder("Найти команду…").fill("Создать папку");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("Название папки").fill("Из команды");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect
    .poll(() =>
      fs.stat(path.join(root, "Из команды")).then(
        (s) => s.isDirectory(),
        () => false,
      ),
    )
    .toBe(true);
  await page.keyboard.press(`${modifier}+s`);
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type(" МОЯ НЕСОХРАНЁННАЯ ПРАВКА");
  await fs.writeFile(path.join(root, "Начало.md"), "# Внешняя версия");
  await expect(page.locator(".save-error")).toContainText("другой программой");
  expect(await fs.readFile(path.join(root, "Начало.md"), "utf8")).toBe(
    "# Внешняя версия",
  );
  await page.getByRole("button", { name: "Сохранить копию", exact: true }).click();
  await page.locator(".prompt-modal input").fill("Моя копия");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect
    .poll(() => fs.readFile(path.join(root, "Моя копия.md"), "utf8").catch(() => null))
    .toContain("МОЯ НЕСОХРАНЁННАЯ ПРАВКА");
});
test("экспорт сайта и отдельный веб-просмотр без доступа к заметкам", async () => {
  const output = path.join(temp, "site");
  await fs.mkdir(output);
  await application.evaluate(({ dialog }, folder) => {
    (dialog as any).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, output);
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("экспорт сайта");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => fs.readFile(path.join(output, "index.html"), "utf8").catch(() => null))
    .toContain("Начало");
  expect(await fs.readFile(path.join(output, "notes", "Начало.html"), "utf8")).toContain(
    "%D0%92%D1%82%D0%BE%D1%80%D0%B0%D1%8F.html",
  );
  const server = http.createServer((request, response) => {
    const relative =
        decodeURIComponent(
          new URL(request.url || "/", "http://localhost").pathname,
        ).slice(1) || "index.html",
      file = path.resolve(output, relative);
    if (!file.startsWith(output + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".css")
          ? "text/css"
          : "application/octet-stream",
    );
    fs.readFile(file).then(
      (data) => response.end(data),
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as any).port,
      opened = application.waitForEvent("window");
    await page.evaluate(
      (url) => window.veltrite.webViewer(url),
      `http://127.0.0.1:${port}/`,
    );
    const browser = await opened;
    await browser.waitForLoadState("domcontentloaded");
    await expect(
      browser.getByRole("heading", { name: "vault", exact: true }),
    ).toBeVisible();
    expect(
      await browser.evaluate(() => ({
        api: (window as any).veltrite,
        node: (window as any).require,
      })),
    ).toEqual({ api: undefined, node: undefined });
    await browser.getByRole("link", { name: "Начало", exact: true }).click();
    await expect(
      browser.getByRole("heading", { name: "Место для ваших мыслей" }),
    ).toBeVisible();
    await browser.close();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("импорт структуры Obsidian, относительные вложения и чтение холста", async () => {
  const source = path.join(temp, "obsidian"),
    destination = path.join(temp, "imported");
  await fs.mkdir(path.join(source, "Раздел"), { recursive: true });
  await fs.mkdir(path.join(source, "Вложения"), { recursive: true });
  await fs.mkdir(destination);
  const original =
    "# Исходная заметка\n\n![Изображение](../Вложения/рисунок.png)\n\n[[Другая]]";
  await fs.writeFile(path.join(source, "Раздел", "Пример.md"), original);
  await fs.writeFile(path.join(source, "Другая.md"), "# Другая");
  await fs.copyFile("resources/icon.png", path.join(source, "Вложения", "рисунок.png"));
  const canvas = JSON.stringify({
    nodes: [
      {
        id: "a",
        type: "text",
        text: "Из Obsidian",
        x: 0,
        y: 0,
        width: 300,
        height: 180,
      },
    ],
    edges: [],
  });
  await fs.writeFile(path.join(source, "Карта.canvas"), canvas);
  await application.evaluate(
    ({ dialog }, folders) => {
      let position = 0;
      (dialog as any).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folders[position++]],
      });
    },
    [source, destination],
  );
  await page.getByRole("button", { name: "Импорт из Obsidian", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Импорт завершён" })).toBeVisible();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  await page.locator(".tree-file").filter({ hasText: "Пример" }).click();
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".reading-pane img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.locator(".tree-file").filter({ hasText: "Карта" }).click();
  await expect(page.getByRole("textbox", { name: "Текст карточки" })).toHaveValue(
    "Из Obsidian",
  );
  expect(await fs.readFile(path.join(destination, "Карта.canvas"), "utf8")).toBe(canvas);
  expect(await fs.readFile(path.join(source, "Раздел", "Пример.md"), "utf8")).toBe(
    original,
  );
});
test("база: фильтры, формулы, изменение свойства и канбан", async () => {
  await fs.writeFile(
    path.join(root, "База.base"),
    'filters:\n  and:\n    - file.ext == "md"\nformulas:\n  upper: file.name.upper()\nviews:\n  - type: table\n    name: Таблица\n    order: [file.name, status, formula.upper]\n  - type: cards\n    name: Карточки\n    order: [file.name, status]\n  - type: kanban\n    name: Доска\n    groupBy:\n      property: note.status\n    groupOrder: [active, done, null]\n    order: [file.name, status]\n',
  );
  await page.locator(".tree-file").filter({ hasText: "База" }).click();
  await expect(page.locator(".base-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".base-table")).toContainText("НАЧАЛО");
  const row = page.locator(".base-table tbody tr").filter({ hasText: "Начало" });
  await row.locator(".editable-cell").dblclick();
  await row.locator("input").fill("done");
  await row.locator("input").blur();
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain("status: done");
  await page.getByLabel("Представление базы").selectOption("1");
  await expect(page.locator(".base-card")).toHaveCount(2);
  await page.getByLabel("Представление базы").selectOption("2");
  await expect(page.locator(".kanban-column")).toHaveCount(3);
  await expect(page.locator(".kanban-column").filter({ hasText: "done" })).toContainText(
    "Начало",
  );
  await page.screenshot({ path: "../screenshots/bases.png" });
});
test("изолированный интерфейс не исполняет HTML из заметки и не читает вне хранилища", async () => {
  await fs.writeFile(
    path.join(root, "Проверка.md"),
    '# Проверка\n\n<script>window.__veltrite_attack_probe_48=true</script>\n<img src=x onerror="window.__veltrite_attack_probe_48=true">\n\n```mermaid\ngraph LR\n A[Идея] --> B[Заметка]\n```',
  );
  await page.locator(".tree-file").filter({ hasText: "Проверка" }).click();
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await expect(page.locator(".diagram svg")).toBeVisible();
  expect(
    await page.evaluate(() => ({
      injected: (window as any).__veltrite_attack_probe_48,
      node: (window as any).require,
    })),
  ).toEqual({ injected: undefined, node: undefined });
  expect(
    await page.evaluate(() =>
      window.veltrite.read("../outside.md").then(
        () => false,
        () => true,
      ),
    ),
  ).toBe(true);
});
test("редактирование, перезапуск, поиск, чтение и локальные свойства", async () => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await expect(page.locator(".cm-content")).toContainText("Место для ваших мыслей");
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type("\n\nТекст после редактирования.");
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain("Текст после редактирования.");
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await expect(page.locator(".reading-pane h1")).toHaveText("Место для ваших мыслей");
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.locator(".reading-pane a").filter({ hasText: "Вторая" }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Связь на");
  await page.locator(".reading-pane a").filter({ hasText: "Вторая" }).click();
  await expect(page.locator(".tab.active")).toContainText("Вторая");
  await page.getByRole("button", { name: "Поиск", exact: true }).first().click();
  await page.getByPlaceholder("Текст, tag:тег, path:папка").fill("после редактирования");
  await expect(page.locator(".search-result")).toContainText("Начало");
  await page.getByRole("button", { name: "Граф знаний", exact: true }).click();
  await expect(page.locator(".graph-node")).toHaveCount(2);
  await expect(page.locator(".graph-svg line")).toHaveCount(2);
  await page.screenshot({ path: "../screenshots/graph.png" });
  await page.keyboard.press(`${modifier}+s`);
  await application.close();
  await launch();
  await expect(page.locator(".tab")).toHaveCount(2);
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await expect(page.locator(".cm-content")).toContainText("Текст после редактирования.");
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await page.screenshot({ path: "../screenshots/editor.png" });
  expect(errors).toEqual([]);
});
test("создание холста, изменение карточки и сохранение JSON Canvas", async () => {
  await page.getByRole("button", { name: "Новый холст", exact: true }).click();
  await page.getByPlaceholder("Папка/Название").fill("Мои идеи");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".canvas-view")).toBeVisible();
  await page.getByRole("button", { name: "Первая карточка" }).click();
  await page.getByRole("textbox", { name: "Текст карточки" }).fill("Идея на холсте");
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(root, "Мои идеи.canvas"), "utf8")).nodes[0]
          ?.text,
    )
    .toBe("Идея на холсте");
  await page.getByRole("button", { name: "Текстовая карточка", exact: true }).click();
  await expect(page.locator(".canvas-node")).toHaveCount(2);
  await page.getByTitle("Соединить две карточки").click();
  await page.locator(".canvas-node-header").nth(0).click();
  await page.locator(".canvas-node-header").nth(1).click();
  await expect(page.locator(".canvas-edges path.edge")).toHaveCount(1);
  const point = await page
    .locator(".canvas-edges path.edge")
    .evaluate((edge: SVGPathElement) => {
      const p = edge.getPointAtLength(edge.getTotalLength() / 2);
      const screen = new DOMPoint(p.x, p.y).matrixTransform(edge.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("textbox", { name: "Подпись связи" }).fill("Связь идей");
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(root, "Мои идеи.canvas"), "utf8")).edges[0]
          ?.label,
    )
    .toBe("Связь идей");
  await page.screenshot({ path: "../screenshots/canvas.png" });
});
test("новая заметка, свойства, закладка, история и восстановление из корзины", async () => {
  await page.getByRole("button", { name: "Новая заметка", exact: true }).click();
  await page.getByPlaceholder("Папка/Название").fill("Работа/Новая");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("Новая");
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type("Первый текст");
  await page.keyboard.press(`${modifier}+s`);
  await page.getByRole("button", { name: "Закладка", exact: true }).click();
  await expect(page.locator(".starred")).toBeVisible();
  await page.getByRole("button", { name: "Свойства", exact: true }).click();
  await page.getByRole("button", { name: "Добавить свойство" }).click();
  await page.getByPlaceholder("Название свойства").fill("status");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByRole("textbox", { name: "Свойство status" }).fill("готово");
  await page.getByRole("textbox", { name: "Свойство status" }).blur();
  await expect
    .poll(() => fs.readFile(path.join(root, "Работа", "Новая.md"), "utf8"))
    .toContain("status: готово");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("radio", { name: "Светлая", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "../screenshots/settings-light.png" });
  await page.getByRole("button", { name: "Закрыть настройки" }).click();
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("корзину");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Корзина" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("История версий");
  await page.keyboard.press("Enter");
  await expect(page.locator(".history-entry").first()).toBeVisible();
  await page.locator(".history-select").first().click();
  await expect(page.locator(".history-body pre")).toContainText("Первый текст");
  await page
    .locator(".history-entry")
    .first()
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await expect(page.locator(".history-modal")).toHaveCount(0);
  const beforeTrash = await fs.readFile(path.join(root, "Работа", "Новая.md"), "utf8");
  await page.locator(".tree-row").filter({ hasText: "Новая" }).hover();
  await page
    .locator(".tree-row")
    .filter({ hasText: "Новая" })
    .getByTitle("Действия с файлом")
    .click();
  await page.getByRole("button", { name: "В корзину", exact: true }).click();
  await page.getByRole("button", { name: "В корзину", exact: true }).click();
  await expect
    .poll(() =>
      fs.stat(path.join(root, "Работа", "Новая.md")).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("Открыть корзину");
  await page.keyboard.press("Enter");
  await page
    .locator(".trash-row")
    .filter({ hasText: "Работа/Новая.md" })
    .getByRole("button", { name: "Восстановить" })
    .click();
  await expect
    .poll(() =>
      fs.readFile(path.join(root, "Работа", "Новая.md"), "utf8").catch(() => null),
    )
    .toBe(beforeTrash);
});

test("главная и коллекции сохраняют открытые вкладки и правки", async () => {
  await fs.writeFile(path.join(root, "План.canvas"), '{"nodes":[],"edges":[]}');
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type(" Правка перед переходом на главную.");
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect(page.locator(".workspace-home h1")).toContainText(
    "Всё начинается с мысли",
  );
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.getByRole("button", { name: "Открыть холсты", exact: true }).click();
  await expect(page.locator(".collection-heading h1")).toHaveText("Холсты");
  await expect(page.locator(".collection-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Найти среди файлов", exact: true })
    .fill("нет такого файла");
  await expect(page.locator(".collection-empty")).toContainText("Ничего не найдено");
  await page
    .getByRole("textbox", { name: "Найти среди файлов", exact: true })
    .fill("План");
  await page.locator(".collection-card").click();
  await expect(page.locator(".canvas-view")).toBeVisible();
  await page.locator('.tab-open[title="Начало.md"]').click();
  await expect(page.locator(".cm-content")).toContainText(
    "Правка перед переходом на главную.",
  );
  await page.keyboard.press(`${modifier}+s`);
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain("Правка перед переходом на главную.");
});

test("в компактном окне навигация и режимы доступны, поиск объясняет пустые результаты", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(940, 680),
  );
  await expect(page.locator(".inspector")).toHaveCount(0);
  for (const name of ["Редактор", "Исходный код", "Чтение", "Редактор и предпросмотр"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    expect(box!.x).toBeGreaterThan(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await page.locator(".panel-toggle").click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page.getByRole("button", { name: "Поиск", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Поиск по содержимому", exact: true });
  await expect(search).toBeFocused();
  await expect(page.locator(".search-guide")).toContainText("Найдите нужную мысль");
  await search.fill("Несуществующая фраза 9375");
  await expect(page.locator(".sidebar-empty")).toContainText("Ничего не найдено");
  await search.fill("Место для ваших мыслей");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await expect(page.locator(".search-result")).toContainText("Начало");
  await page.getByRole("button", { name: "Очистить поиск", exact: true }).click();
  await expect(page.locator(".search-guide")).toBeVisible();
});

test("системная тема реагирует без перезапуска, диалоги возвращают фокус", async () => {
  const settings = page.getByRole("button", { name: "Настройки", exact: true });
  await settings.click();
  await page.getByRole("radio", { name: "Системная", exact: true }).check();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(root, ".veltrite", "preferences.json"), "utf8"),
        ).theme,
    )
    .toBe("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("switch").focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Оформление", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Настройки", exact: true })).toHaveCount(
    0,
  );
  await expect(settings).toBeFocused();
  const commands = page.getByRole("button", { name: "Палитра команд", exact: true });
  await commands.click();
  await page.getByPlaceholder("Найти команду…").fill("Настройки");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Настройки", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".overlay")).toHaveCount(0);
});
