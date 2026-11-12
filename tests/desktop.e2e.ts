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
    "---\ntags: [начало]\nstatus: active\n---\n# Начало\n\nТекст заметки и [[Вторая]] связь.\n\n## План\n- [ ] Проверить план\n\n$$E=mc^2$$\n",
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
  await page
    .getByRole("button", { name: "Опубликовать базу знаний: экспорт сайта", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const failure = (await page.locator(".toast.error").count())
          ? await page.locator(".toast.error").textContent()
          : null;
        if (failure) throw Error(failure);
        return fs.readFile(path.join(output, "index.html"), "utf8").catch(() => null);
      },
      { timeout: 15000 },
    )
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
    await expect(browser.getByRole("heading", { name: "Начало" })).toBeVisible();
    await browser.close();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("импорт структуры папки, относительные вложения и чтение холста", async () => {
  const source = path.join(temp, "source-folder"),
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
        text: "Из исходной папки",
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
  await page.locator(".vault-switch").click();
  await page.getByRole("button", { name: "Импорт из папки…", exact: true }).click();
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
    "Из исходной папки",
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
  await expect(page.locator(".cm-content")).toContainText("Начало");
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type("\n\nТекст после редактирования.");
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain("Текст после редактирования.");
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await expect(page.locator(".reading-pane h1")).toHaveText("Начало");
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
  await expect(page.locator(".reading-pane")).toContainText(
    "Текст после редактирования.",
  );
  await page.getByRole("button", { name: "Правка", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("Текст после редактирования.");
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await page.screenshot({ path: "../screenshots/editor.png" });
  expect(errors).toEqual([]);
});
test("создание холста, изменение карточки и сохранение JSON Canvas", async () => {
  await page.getByRole("button", { name: "Создать файл", exact: true }).click();
  await page.getByRole("menuitem", { name: "Новый холст", exact: true }).click();
  await page.getByPlaceholder("Папка/Название").fill("Мои идеи");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".canvas-view")).toBeVisible();
  await page.getByRole("button", { name: "Текстовая карточка", exact: true }).click();
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
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(940, 680),
  );
  await page.getByRole("button", { name: "Создать файл", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Новая заметка/ }).click();
  await page.getByPlaceholder("Папка/Название").fill("Работа/Новая");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("Новая");
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type("Первый текст");
  await page.keyboard.press(`${modifier}+s`);
  await page.getByRole("button", { name: "Закладка", exact: true }).click();
  await expect(page.locator(".starred")).toBeVisible();
  if (!(await page.locator(".inspector").isVisible()))
    await page.locator(".panel-toggle").click();
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
  await expect(page.locator(".workspace-home h1")).toContainText("Главная");
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.getByRole("button", { name: "Фильтр файлов", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Холсты", exact: true }).click();
  await expect(page.locator(".collection-heading h1")).toHaveText("Холсты");
  await expect(page.locator(".collection-row")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Найти среди файлов", exact: true })
    .fill("нет такого файла");
  await expect(page.locator(".collection-empty")).toContainText("Ничего не найдено");
  await page
    .getByRole("textbox", { name: "Найти среди файлов", exact: true })
    .fill("План");
  await page.locator(".collection-row").click();
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
  const reading = page.getByRole("button", { name: "Чтение", exact: true });
  await expect(reading).toBeVisible();
  const box = await reading.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await page.getByRole("button", { name: "Действия с документом", exact: true }).click();
  await page.getByRole("button", { name: "Редактор: исходный код", exact: true }).click();
  await expect(page.locator(".source-editor")).toBeVisible();
  await page.getByRole("button", { name: "Действия с документом", exact: true }).click();
  await page
    .getByRole("button", { name: "Редактор и предпросмотр рядом", exact: true })
    .click();
  await expect(page.locator(".mode-split")).toBeVisible();
  await page.locator(".panel-toggle").click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page.getByRole("button", { name: "Поиск", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Поиск по содержимому", exact: true });
  await expect(search).toBeFocused();
  await expect(page.locator(".search-guide")).toContainText("Поиск по заметкам");
  await search.fill("Несуществующая фраза 9375");
  await expect(page.locator(".sidebar-empty")).toContainText("Ничего не найдено");
  await search.fill("Текст заметки");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await expect(page.locator(".search-result")).toContainText("Текст заметки");
  await page.getByRole("button", { name: "Очистить поиск", exact: true }).click();
  await expect(page.locator(".search-guide")).toBeVisible();
});

test("системная тема реагирует без перезапуска, диалоги возвращают фокус", async () => {
  const settings = page.getByRole("button", { name: "Настройки", exact: true });
  await settings.click();
  await page.getByRole("radio", { name: "Системная", exact: true }).check();
  await expect
    .poll(async () => {
      try {
        return JSON.parse(
          await fs.readFile(path.join(root, ".veltrite", "preferences.json"), "utf8"),
        ).theme;
      } catch (error: any) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    })
    .toBe("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Установить Сланец", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Оформление", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Настройки", exact: true })).toHaveCount(
    0,
  );
  await expect(settings).toBeFocused();
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("Настройки");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Настройки", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".overlay")).toHaveCount(0);
});

test("⌘/Ctrl E переключает правку и чтение, текст начинается в верхних 100 px", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.keyboard.press(`${modifier}+e`);
  await expect(page.locator(".reading-pane h1")).toHaveText("Начало");
  expect((await page.locator(".reading-pane h1").boundingBox())!.y).toBeLessThanOrEqual(
    100,
  );
  expect(
    (await page.locator(".document-toolbar").boundingBox())!.height,
  ).toBeLessThanOrEqual(40);
  await page.keyboard.press(`${modifier}+e`);
  await expect(page.locator(".cm-content")).toContainText("Текст заметки");
  await page.keyboard.press(`${modifier}+o`);
  await expect(page.getByPlaceholder("Перейти к файлу…")).toBeFocused();
});

test("запуск с главной сохраняет вкладки и настройку шрифта", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("При запуске открывать").selectOption("home");
  await expect
    .poll(async () => {
      try {
        return JSON.parse(
          await fs.readFile(path.join(root, ".veltrite", "preferences.json"), "utf8"),
        ).startupView;
      } catch (error: any) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    })
    .toBe("home");
  await page.getByLabel("Шрифт текста", { exact: true }).selectOption("sans");
  await expect(page.locator("html")).toHaveAttribute("data-text-font", "sans");
  await page.getByRole("button", { name: "Закрыть настройки", exact: true }).click();
  await page.keyboard.press(`${modifier}+s`);
  await expect
    .poll(async () => (await page.evaluate(() => window.veltrite.state())).session?.tabs)
    .toContain("Начало.md");
  await application.close();
  await launch();
  await expect(page.locator(".workspace-home")).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.locator(".tab-open").click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-text-font", "sans");
});

test("системное уменьшение движения отключает плавный переход к заголовку", async () => {
  await fs.writeFile(
    path.join(root, "Длинная.md"),
    "# Длинная\n\n" +
      "Абзац для проверки прокрутки.\n\n".repeat(150) +
      "## Раздел внизу\n\nКонец документа.",
  );
  await page.locator(".tree-file").filter({ hasText: "Длинная" }).click();
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  if (!(await page.locator(".inspector").isVisible()))
    await page.locator(".panel-toggle").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Раздел внизу", exact: true }).click();
  // At the next paint the target is already in view; a smooth scroll would still be near the beginning.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const target = await page
    .getByRole("heading", { name: "Раздел внизу", exact: true })
    .boundingBox();
  expect(target!.y).toBeLessThan(await page.evaluate(() => window.innerHeight));
  expect(
    await page
      .locator(".reading-toggle")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
});

test("живые таблицы, формулы и Mermaid редактируются без потери исходного текста", async () => {
  const source =
    "# Блоки\n\nВступление.\n\n| Поле | Значение |\n| --- | --- |\n| Число | 2 |\n\n$$\nx^2 + y^2\n$$\n\n```mermaid\ngraph LR\n A[Начало] --> B[Проверка]\n```\n\nКонец.\n";
  await fs.writeFile(path.join(root, "Блоки.md"), source);
  await page.locator(".tree-file").filter({ hasText: "Блоки" }).click();
  await expect(page.locator(".cm-rendered-table table")).toContainText("Число");
  await expect(page.locator(".cm-rendered-math .katex").first()).toBeVisible();
  await expect(page.locator(".cm-rendered-mermaid .diagram svg")).toBeVisible();
  await page.getByRole("button", { name: "Править таблицу", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("| Поле | Значение |");
  await page.keyboard.press(`${modifier}+a`);
  const changed = source.replace("| Число | 2 |", "| Число | 42 |");
  await page.keyboard.insertText(changed);
  await page.keyboard.press(`${modifier}+s`);
  await expect.poll(() => fs.readFile(path.join(root, "Блоки.md"), "utf8")).toBe(changed);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page.locator('.tab-open[title="Блоки.md"]').click();
  await expect(page.locator(".cm-rendered-table table")).toContainText("42");
  await expect(page.locator(".cm-rendered-mermaid .diagram svg")).toBeVisible();
});

test("предпросмотр ссылки доступен в редакторе, ID блока не попадает в чтение", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.locator(".cm-wiki-link a").filter({ hasText: "Вторая" }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Связь на");
  await fs.writeFile(
    path.join(root, "Цель.md"),
    "# Цель\n\nНачальный абзац.\n\nТочный фрагмент ^part\n\nПоследний абзац.",
  );
  await fs.writeFile(
    path.join(root, "Блок-ссылка.md"),
    "# Ссылки\n\n[[Цель#^part|К блоку]]\n\n![[Цель#^part]]\n",
  );
  await page.locator(".tree-file").filter({ hasText: "Блок-ссылка" }).click();
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await expect(page.locator(".embed-note .markdown")).toContainText("Точный фрагмент");
  await expect(page.locator(".embed-note .markdown")).not.toContainText(
    "Начальный абзац",
  );
  await expect(page.locator(".embed-note .markdown")).not.toContainText(
    "Последний абзац",
  );
  await page.getByRole("link", { name: "К блоку", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("Цель");
  await expect(page.locator(".reading-pane #block-part")).toHaveText("Точный фрагмент");
  await expect(page.locator(".reading-pane")).not.toContainText("^part");
});

test("разделённые панели сохраняют файлы, режимы и общий черновик после перезапуска", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.getByRole("button", { name: "Разделить вправо", exact: true }).click();
  await expect(page.locator(".document-leaf")).toHaveCount(2);
  const left = page.locator(".document-leaf").nth(0),
    right = page.locator(".document-leaf").nth(1);
  await right.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type(" ОБЩИЙ ЧЕРНОВИК");
  await expect(left.locator(".cm-content")).toContainText("ОБЩИЙ ЧЕРНОВИК");
  await page.locator(".tree-file").filter({ hasText: "Вторая" }).click();
  await right.getByRole("button", { name: "Чтение", exact: true }).click();
  await expect(right.locator(".reading-pane")).toContainText("Вторая");
  await expect(left.locator(".cm-content")).toContainText("Начало");
  await page.getByRole("separator", { name: "Размер панелей" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("separator", { name: "Размер панелей" })).toHaveAttribute(
    "aria-valuenow",
    "55",
  );
  await page.keyboard.press(`${modifier}+s`);
  await application.close();
  await launch();
  await expect(page.locator(".document-leaf")).toHaveCount(2);
  await expect(
    page.locator(".document-leaf").nth(0).locator(".cm-content"),
  ).toContainText("ОБЩИЙ ЧЕРНОВИК");
  await expect(
    page.locator(".document-leaf").nth(1).locator(".reading-pane"),
  ).toContainText("Вторая");
  await page
    .locator(".document-leaf")
    .nth(1)
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(page.locator(".document-leaf")).toHaveCount(1);
  expect(await fs.readFile(path.join(root, "Начало.md"), "utf8")).toContain(
    "ОБЩИЙ ЧЕРНОВИК",
  );
});

test("расширенный поиск сочетает группы, свойства и регулярные выражения", async () => {
  await page.getByRole("button", { name: "Поиск", exact: true }).first().click();
  const input = page.getByPlaceholder("Текст, tag:тег, path:папка");
  await input.fill(
    "(content:/Текст.*заметки/iu OR file:Вторая) [status:active] -tag:архив",
  );
  await expect(page.locator(".search-result")).toHaveCount(1);
  await expect(page.locator(".search-result")).toContainText("Начало");
  await input.fill("(Начало OR");
  await expect(page.locator(".search-summary")).toContainText("условие");
  await input.fill("file:Вторая NOT [status]");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await expect(page.locator(".search-result")).toContainText("Вторая");
});

test("база: типы, итоги и карта с нулевыми координатами", async () => {
  await fs.writeFile(
    path.join(root, "Место.md"),
    "---\nprice: 12\ndone: false\nlatitude: 0\nlongitude: 0\n---\n# Место",
  );
  await fs.writeFile(
    path.join(root, "Места.base"),
    'filters: file.ext == "md"\nproperties:\n  price:\n    type: number\n  done:\n    type: checkbox\nviews:\n  - type: table\n    name: Таблица\n    order: [file.name, price, done]\n    summaries:\n      price: Sum\n  - type: map\n    name: Карта\n',
  );
  await page.locator(".tree-file").filter({ hasText: "Места" }).click();
  await expect(page.locator(".base-summary")).toHaveText("12");
  const checkbox = page.getByRole("checkbox", { name: "done: Место" });
  await checkbox.check();
  await expect
    .poll(() => fs.readFile(path.join(root, "Место.md"), "utf8"))
    .toContain("done: true");
  await page.getByLabel("Представление базы").selectOption({ label: "Карта" });
  await expect(page.locator(".base-map-points")).toContainText("Место");
  await expect(page.locator(".base-map-points")).toContainText("0, 0");
  await expect(page.locator(".leaflet-tile")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Загрузить карту OpenStreetMap" }),
  ).toBeVisible();
});

test("встроенная веб-карточка изолирована и закрывается вместе с холстом", async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<h1>Встроенная страница</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number },
    url = `http://127.0.0.1:${address.port}/`;
  try {
    await fs.writeFile(
      path.join(root, "Веб.canvas"),
      JSON.stringify({
        nodes: [{ id: "web", type: "link", url, x: 0, y: 0, width: 500, height: 400 }],
        edges: [],
      }),
    );
    await page.locator(".tree-file").filter({ hasText: "Веб" }).click();
    await page.getByRole("button", { name: "Открыть здесь", exact: true }).click();
    await expect
      .poll(() =>
        application.evaluate(
          ({ webContents }, address) =>
            webContents.getAllWebContents().some((c) => c.getURL() === address),
          url,
        ),
      )
      .toBe(true);
    const isolated = await application.evaluate(async ({ webContents }, address) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL() === address)!;
      return contents.executeJavaScript(
        '({node: typeof require, process: typeof process, bridge: typeof window.veltrite, title: document.querySelector("h1").textContent})',
      );
    }, url);
    expect(isolated).toEqual({
      node: "undefined",
      process: "undefined",
      bridge: "undefined",
      title: "Встроенная страница",
    });
    await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
    await expect
      .poll(() =>
        application.evaluate(
          ({ webContents }, address) =>
            webContents.getAllWebContents().some((c) => c.getURL() === address),
          url,
        ),
      )
      .toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("большой холст сохраняет все карточки и ограничивает количество редакторов на экране", async () => {
  const nodes = Array.from({ length: 5000 }, (_, i) => ({
    id: String(i),
    type: "text",
    text: "Карточка " + i,
    x: (i % 100) * 260,
    y: Math.floor(i / 100) * 180,
    width: 240,
    height: 160,
    extra: { preserve: true },
  }));
  const original = JSON.stringify({ nodes, edges: [], custom: { preserve: true } });
  await fs.writeFile(path.join(root, "Большой.canvas"), original);
  await page.locator(".tree-file").filter({ hasText: "Большой" }).click();
  await expect(page.locator(".canvas-overview")).toBeVisible();
  await expect(page.locator(".canvas-controls")).toContainText("5000 карточек");
  for (let i = 0; i < 16; i++)
    await page.getByTitle("Увеличить", { exact: true }).click();
  await expect(page.locator(".canvas-overview")).toHaveCount(0);
  await expect.poll(() => page.locator(".canvas-node").count()).toBeGreaterThan(0);
  expect(await page.locator(".canvas-node").count()).toBeLessThan(200);
  await page.locator(".canvas-node textarea").first().fill("Изменённая карточка");
  await expect
    .poll(async () =>
      JSON.parse(await fs.readFile(path.join(root, "Большой.canvas"), "utf8")).nodes.some(
        (n: { text: string }) => n.text === "Изменённая карточка",
      ),
    )
    .toBe(true);
  const saved = JSON.parse(await fs.readFile(path.join(root, "Большой.canvas"), "utf8"));
  expect(saved.nodes).toHaveLength(5000);
  expect(saved.custom).toEqual({ preserve: true });
  expect(
    saved.nodes.every((n: { extra: { preserve: boolean } }) => n.extra.preserve),
  ).toBe(true);
});

test("граф отображает более 500 заметок, дерево файлов остаётся компактным", async () => {
  await application.close();
  const files = Array.from({ length: 1600 }, (_, i) => ({
    name: `n${String(i).padStart(4, "0")}.md`,
    text: `# Узел ${i}\n[[n${String((i + 1) % 1600).padStart(4, "0")}]]`,
  }));
  for (let offset = 0; offset < files.length; offset += 32)
    await Promise.all(
      files
        .slice(offset, offset + 32)
        .map((file) => fs.writeFile(path.join(root, file.name), file.text)),
    );
  await launch();
  expect(await page.locator(".tree-file").count()).toBeLessThan(100);
  await page.getByRole("button", { name: "Граф знаний", exact: true }).click();
  await expect(page.locator(".graph-canvas")).toHaveAttribute(
    "aria-label",
    "Граф: 1602 заметок",
  );
  await page.getByPlaceholder("Найти в графе…").fill("n1599");
  await expect(page.locator(".graph-node")).toHaveCount(1);
  await page.locator(".graph-node").click();
  await expect(page.locator(".tab.active")).toContainText("n1599");
  await expect(page.locator(".tree-row.active")).toContainText("n1599");
  expect(await page.locator(".tree-file").count()).toBeLessThan(100);
});

async function installScript(id: string, permissions: string[], code: string) {
  const folder = path.join(temp, "extension-" + id);
  await fs.mkdir(folder);
  const manifest = path.join(folder, "manifest.json");
  await fs.writeFile(
    manifest,
    JSON.stringify({
      id,
      name: "Тест " + id,
      description: "Синтетическое расширение",
      version: "1.0.0",
      apiVersion: 1,
      main: "main.js",
      permissions,
      commands: [{ id: "run", name: "Выполнить" }],
    }),
  );
  await fs.writeFile(path.join(folder, "main.js"), code);
  await application.evaluate(({ dialog }, file) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, manifest);
  await page.evaluate(() => window.veltrite.installPlugin());
}
test("JavaScript-расширение запрашивает разрешения и работает без Node и доступа к API окна", async () => {
  const permissions = ["vault.read", "vault.write", "editor.write", "storage"];
  await installScript(
    "sandbox",
    permissions,
    `export default async api=>{
    await api.commands.register("run",async()=>{
      let escaped=false, metadata=false;
      try{await api.vault.read("../outside.txt");escaped=true;}catch{}
      try{await api.vault.read(".veltrite/vault.json");metadata=true;}catch{}
      await api.vault.create("Из расширения.md",JSON.stringify({node:typeof require,process:typeof process,bridge:typeof window.veltrite,escaped,metadata}));
      await api.editor.replaceSelection("ВСТАВКА ИЗ РАСШИРЕНИЯ");
    });
    api.onUnload(()=>api.storage.set("disposed",true));
  };`,
  );
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.keyboard.press(`${modifier}+,`);
  await page.getByRole("button", { name: "Расширения", exact: true }).click();
  await page.getByRole("switch", { name: "Тест sandbox · 1.0.0" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Разрешения расширения" }),
  ).toContainText("Читать файлы хранилища");
  await page.getByRole("button", { name: "Разрешить и включить", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Тест sandbox · 1.0.0" })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.veltrite.executePlugin("sandbox", "run"));
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain("ВСТАВКА ИЗ РАСШИРЕНИЯ");
  expect(
    JSON.parse(await fs.readFile(path.join(root, "Из расширения.md"), "utf8")),
  ).toEqual({
    node: "undefined",
    process: "undefined",
    bridge: "undefined",
    escaped: false,
    metadata: false,
  });
  await page.evaluate(() => window.veltrite.togglePlugin("sandbox", false));
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(temp, "profile", "plugins", "data", "sandbox.json"),
        "utf8",
      ),
    ),
  ).toEqual({ disposed: true });
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    )
    .toBe(1);
});
test("расширение без разрешения не читает заметки", async () => {
  await installScript(
    "denied",
    ["notice"],
    `export default async api=>{await api.commands.register("run",async()=>{try{await api.vault.read("Начало.md");await api.notice("UNEXPECTED");}catch(error){await api.notice(error.message);}});};`,
  );
  await page.evaluate(() => window.veltrite.togglePlugin("denied", true, ["notice"]));
  await page.evaluate(() => window.veltrite.executePlugin("denied", "run"));
  await expect(page.locator(".toast")).toContainText("Нет разрешения: vault.read");
});
test("зависшая команда отключает только своё расширение", async () => {
  await installScript(
    "hang",
    [],
    `export default async api=>{await api.commands.register("run",()=>{while(true){}});};`,
  );
  await page.evaluate(() => window.veltrite.togglePlugin("hang", true, []));
  const command = page.evaluate(() =>
    window.veltrite.executePlugin("hang", "run").catch((error) => error.message),
  );
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await expect(page.locator(".cm-content")).toContainText("Начало");
  expect(await command).toContain("время ожидания");
  expect(
    (await page.evaluate(() => window.veltrite.plugins())).find(
      (plugin) => plugin.id === "hang",
    )?.enabled,
  ).toBe(false);
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    )
    .toBe(1);
});

test("расширение не перезаписывает файл по устаревшей ревизии", async () => {
  await installScript(
    "revision",
    ["vault.read", "vault.write", "notice"],
    `export default async api=>{await api.commands.register("run",async()=>{const note=await api.vault.read("Начало.md");await api.notice("ГОТОВ К ЗАПИСИ");await new Promise(resolve=>setTimeout(resolve,600));await api.vault.write(note.path,"ПРАВКА ПЛАГИНА",note.revision);});};`,
  );
  await page.evaluate(() =>
    window.veltrite.togglePlugin("revision", true, [
      "vault.read",
      "vault.write",
      "notice",
    ]),
  );
  const command = page.evaluate(() =>
    window.veltrite.executePlugin("revision", "run").catch((error) => error.message),
  );
  await expect(page.locator(".toast")).toContainText("ГОТОВ К ЗАПИСИ");
  await fs.writeFile(path.join(root, "Начало.md"), "# Более свежая правка");
  expect(await command).toContain("другой программой");
  expect(await fs.readFile(path.join(root, "Начало.md"), "utf8")).toBe(
    "# Более свежая правка",
  );
});

test("каталог устанавливает тему без сети, оформление сохраняется после перезапуска", async () => {
  await page.keyboard.press(`${modifier}+,`);
  const browser = page.getByRole("region", { name: "Темы оформления", exact: true });
  await browser.getByRole("button", { name: "Установить Сланец", exact: true }).click();
  await browser.getByRole("button", { name: "Применить", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    )
    .toBe("#171c25");
  await page.getByRole("radio", { name: "Светлая", exact: true }).check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    )
    .toBe("#f5f7fc");
  await page.keyboard.press("Escape");
  await application.close();
  await launch();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    )
    .toBe("#f5f7fc");
  await page.keyboard.press(`${modifier}+,`);
  await page.getByRole("button", { name: "Стандартная палитра", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    )
    .toBe("#fbfaf7");
});
test("расширение из каталога включается после разрешения и удаляется через настройки", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.keyboard.press(`${modifier}+,`);
  await page.getByRole("button", { name: "Расширения", exact: true }).click();
  const catalog = page.getByRole("region", { name: "Каталог расширений", exact: true });
  await catalog
    .getByRole("button", { name: "Установить Дата и время", exact: true })
    .click();
  const toggle = page.getByRole("switch", { name: "Дата и время · 1.0.0" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await page.getByRole("button", { name: "Разрешить и включить", exact: true }).click();
  await expect(toggle).toBeChecked();
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("Дата и время: Вставить");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain(String(new Date().getFullYear()));
  await page.keyboard.press(`${modifier}+,`);
  await page.getByRole("button", { name: "Расширения", exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить расширение Дата и время", exact: true })
    .click();
  await expect(toggle).toHaveCount(0);
  expect(await page.evaluate(() => window.veltrite.plugins())).toEqual([]);
});
