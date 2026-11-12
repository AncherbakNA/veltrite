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
import { frontmatter } from "../shared/markdown";
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
async function invokeCommand(name: string) {
  await page.keyboard.press(`${modifier}+p`);
  const palette = page.getByRole("dialog", { name: "Палитра команд" });
  await palette.locator("input").fill(name);
  await palette.getByRole("button", { name, exact: true }).click();
}
test("чтение: задачи, выноски, сворачивание заголовков и поиск по заметке", async () => {
  await page.evaluate(() =>
    window.veltrite.create(
      "Чтение.md",
      "# Чтение\n\n> [!warning]- Важно\n> Детали выноски.\n\n- [ ] Выполнить дело\n\n## Раздел\n\nИскомое слово.\n\nЕщё искомое слово.\n",
    ),
  );
  await page.locator(".tree-file").filter({ hasText: "Чтение" }).click();
  await page.locator(".reading-toggle").click();
  await expect(page.locator(".callout-content")).toBeHidden();
  await page.getByRole("button", { name: "Важно", exact: true }).click();
  await expect(page.locator(".callout-content")).toBeVisible();
  await page.getByRole("checkbox", { name: "Выполнить дело", exact: true }).check();
  await expect
    .poll(() => fs.readFile(path.join(root, "Чтение.md"), "utf8"))
    .toContain("- [x] Выполнить дело");
  await page
    .getByRole("heading", { name: "Раздел", exact: true })
    .getByRole("button", { name: "Свернуть раздел", exact: true })
    .click();
  await expect(
    page.locator(".reading-pane p").filter({ hasText: "Искомое слово." }).first(),
  ).toBeHidden();
  await page.keyboard.press(`${modifier}+f`);
  await page.getByLabel("Найти в заметке", { exact: true }).fill("искомое");
  await expect(page.locator("mark[data-find-match]")).toHaveCount(2);
  await expect(page.locator("mark.find-current")).toBeVisible();
  await page.getByRole("button", { name: "Следующее совпадение", exact: true }).click();
  await expect(page.locator(".reading-find small")).toContainText("2 / 2");
});
test("вложения: PDF, база, холст и циклические заметки отображаются внутри чтения", async () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["First PDF page", "Second searchable page"].map((text) => {
      const stream = `BT /F1 20 Tf 30 430 Td (${text}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let data = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(data);
  data += `xref\n0 8\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((value) => String(value).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fs.writeFile(path.join(root, "Тест.pdf"), data);
  await page.evaluate(async () => {
    await window.veltrite.create(
      "Встроенная.base",
      `filters: 'file.name == "Вторая.md"'\nviews:\n  - type: table\n    name: Связи\n    order: [file.name]\n`,
    );
    await window.veltrite.create(
      "Встроенный.canvas",
      JSON.stringify({
        nodes: [
          {
            id: "one",
            type: "text",
            text: "Карточка вложенного холста",
            x: 0,
            y: 0,
            width: 300,
            height: 150,
          },
        ],
        edges: [],
      }),
    );
    await window.veltrite.create("Цикл.md", "![[Вложения]]");
    await window.veltrite.create(
      "Вложения.md",
      `# Вложения\n\n![[Тест.pdf#page=2]]\n\n![[Встроенная.base#Связи]]\n\n![[Встроенный.canvas]]\n\n![[Цикл]]\n\n\`\`\`base\nfilters: 'file.name == "Вторая.md"'\nviews:\n  - type: list\n    name: Встроенный список\n    order: [file.name]\n\`\`\`\n`,
    );
  });
  await page.locator(".tree-file").filter({ hasText: "Вложения" }).click();
  await page.locator(".reading-toggle").click();
  const pdf = page.locator(".pdf-viewer");
  await expect(pdf.locator(".textLayer")).toContainText("Second searchable page");
  await expect(pdf.getByLabel("Страница PDF", { exact: true })).toHaveValue("2");
  await pdf.getByRole("button", { name: "Предыдущая страница PDF", exact: true }).click();
  await expect(pdf.locator(".textLayer")).toContainText("First PDF page");
  await pdf.getByLabel("Найти в PDF", { exact: true }).fill("searchable");
  await pdf.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(pdf.getByLabel("Страница PDF", { exact: true })).toHaveValue("2");
  await expect(page.locator(".embed-content .base-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".canvas-text-preview")).toContainText(
    "Карточка вложенного холста",
  );
  await expect(
    page.locator(".inline-link").filter({ hasText: "повторное вложение" }),
  ).toHaveCount(1);
  await expect(page.locator(".inline-base")).toContainText("Вторая");
  await page.evaluate(() =>
    window.veltrite.create("Ссылка PDF.md", "[[Тест.pdf#page=2|Страница PDF]]"),
  );
  await page.locator(".tree-file").filter({ hasText: "Ссылка PDF" }).click();
  await page.locator(".reading-toggle").click();
  await page.getByRole("link", { name: "Страница PDF", exact: true }).click();
  await expect(page.locator(".focused-pane > .pdf-viewer .textLayer")).toContainText(
    "Second searchable page",
  );
});
test("дерево файлов перемещает заметку перетаскиванием и управляется стрелками", async () => {
  await page.evaluate(async () => {
    await window.veltrite.mkdir("Папка");
    await window.veltrite.create("Перенос.md", "# Перенос");
    await window.veltrite.create("Ссылается.md", "[[Перенос]]");
  });
  const file = page.locator('.tree-file[data-file-path="Перенос.md"]'),
    folder = page.locator('.tree-file[data-file-path="Папка"]');
  await file.click();
  await file.dragTo(folder);
  await expect
    .poll(() => fs.readFile(path.join(root, "Папка/Перенос.md"), "utf8").catch(() => ""))
    .toContain("# Перенос");
  await expect(page.locator(".tab.active")).toContainText("Перенос");
  expect(await fs.readFile(path.join(root, "Ссылается.md"), "utf8")).toContain(
    "[[Папка/Перенос]]",
  );
  await folder.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator('.tree-file[data-file-path="Папка/Перенос.md"]'),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(folder).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(folder).toHaveAttribute("aria-expanded", "false");
});
test("слайды учитывают YAML и разделители в коде, клавиатура не выходит за последнюю страницу", async () => {
  await page.evaluate(() =>
    window.veltrite.create(
      "Презентация.md",
      "---\ntags: [deck]\n---\n# First slide\n\n```md\n---\n```\n\n---\n# Second slide\n",
    ),
  );
  await page.locator(".tree-file").filter({ hasText: "Презентация" }).click();
  await invokeCommand("Показать заметку как слайды");
  const deck = page.getByRole("dialog", { name: "Слайды", exact: true });
  await expect(deck.locator(".slides-controls span")).toHaveText("1 / 2");
  await expect(
    deck.getByRole("heading", { name: "First slide", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(deck.locator(".slides-controls span")).toHaveText("2 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(
    deck.getByRole("heading", { name: "Second slide", exact: true }),
  ).toBeVisible();
  await expect(
    deck.getByRole("button", { name: "Следующий слайд", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(deck.locator(".slides-controls span")).toHaveText("1 / 2");
  await page.keyboard.press("Escape");
  await expect(deck).toBeHidden();
});
test("свойства используют флажок и дату, список сохраняет запятую внутри элемента", async () => {
  await page.evaluate(async () => {
    await window.veltrite.create(
      "Свойства.md",
      "---\ndone: false\ndue: 2026-01-01\npeople: [один, два]\n---\n# Свойства",
    );
    await window.veltrite.preferences({
      propertyTypes: { done: "checkbox", due: "date", people: "list" },
    });
  });
  await page.locator(".tree-file").filter({ hasText: "Свойства" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  if (!(await page.locator(".inspector").isVisible()))
    await page.locator(".panel-toggle").click();
  const inspector = page.locator(".inspector");
  await inspector.getByLabel("Свойства", { exact: true }).click();
  await inspector.getByRole("checkbox", { name: "Свойство done", exact: true }).check();
  const date = inspector.getByLabel("Свойство due", { exact: true });
  await date.fill("2026-12-24");
  await date.press("Tab");
  const list = inspector.getByLabel("Свойство people", { exact: true });
  await list.fill('["один, два", "три"]');
  await list.press("Tab");
  await expect
    .poll(
      async () =>
        frontmatter(await fs.readFile(path.join(root, "Свойства.md"), "utf8")).properties,
    )
    .toMatchObject({ done: true, due: "2026-12-24", people: ["один, два", "три"] });
});
test("PDF экспортирует содержимое только выбранной панели", async () => {
  await page.evaluate(async () => {
    await window.veltrite.create("Left.md", "# ONLY LEFT");
    await window.veltrite.create("Right.md", "# VISIBLE RIGHT");
  });
  await page.locator(".tree-file").filter({ hasText: "Left" }).click();
  await invokeCommand("Разделить панель вправо");
  await page.locator(".tree-file").filter({ hasText: "Right" }).click();
  const output = path.join(temp, "focused.pdf");
  await application.evaluate(({ dialog }, file) => {
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await invokeCommand("Экспортировать PDF");
  await expect
    .poll(
      () =>
        fs.stat(output).then(
          (stat) => stat.size,
          () => 0,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(100);
  await fs.copyFile(output, path.join(root, "Печатная.pdf"));
  await page.evaluate(() => window.veltrite.create("Обновление.md", "Текст"));
  await page.locator(".tree-file").filter({ hasText: "Печатная" }).click();
  await expect(page.locator(".focused-pane .textLayer")).toContainText("VISIBLE RIGHT");
  await expect(page.locator(".focused-pane .textLayer")).not.toContainText("ONLY LEFT");
});
test("неизменённая ячейка с некорректной датой остаётся целой после фокуса и закрытия", async () => {
  const content = "---\ndue: не_дата\n---\n# Дата";
  await page.evaluate(async (content) => {
    await window.veltrite.create("Дата.md", content);
    await window.veltrite.preferences({ propertyTypes: { due: "date" } });
    await window.veltrite.create(
      "Даты.base",
      `filters: 'file.name == "Дата.md"'\nviews:\n  - type: table\n    name: Даты\n    order: [file.name, due]\n`,
    );
  }, content);
  await page.locator(".tree-file").filter({ hasText: "Даты" }).click();
  await page.locator(".base-table .editable-cell").dblclick();
  const cell = page.getByLabel("Изменить due", { exact: true });
  await expect(cell).toBeVisible();
  await cell.blur();
  await expect(cell).toBeHidden();
  await page.locator('.tree-file[data-file-path="Дата.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("не_дата");
  if (!(await page.locator(".inspector").isVisible()))
    await page.locator(".panel-toggle").click();
  await page.locator(".inspector").getByLabel("Свойства", { exact: true }).click();
  const field = page.getByLabel("Свойство due", { exact: true });
  await field.focus();
  await field.blur();
  await invokeCommand("Сохранить изменения");
  await expect(page.locator(".cm-content")).toContainText("не_дата");
  expect(await fs.readFile(path.join(root, "Дата.md"), "utf8")).toBe(content);
});
test("копирование текста использует системный буфер без разрешения браузера", async () => {
  test.skip(!process.env.CI, "Буфер обмена проверяется только в одноразовой CI-системе");
  await page.evaluate(() => window.veltrite.copyText("[[Синтетическая.pdf#page=2]]"));
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    "[[Синтетическая.pdf#page=2]]",
  );
});
test("долгая формула базы прерывается в worker, интерфейс и исходный файл остаются доступными", async () => {
  const content = `filters: 'file.ext == "md"'\nformulas:\n  slow: '/^(a+)+$/.matches("a".repeat(300) + "!")'\nviews:\n  - type: table\n    name: Долгая формула\n    order: [file.name, formula.slow]\n`;
  await page.evaluate(
    (content) => window.veltrite.create("Долгая.base", content),
    content,
  );
  await page.locator(".tree-file").filter({ hasText: "Долгая" }).click();
  await page.getByRole("button", { name: "Настроить базу", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Настройка базы", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Закрыть настройку базы", exact: true }).click();
  await expect(page.locator(".base-view .save-error")).toContainText(
    "слишком много времени",
    { timeout: 12000 },
  );
  expect(await fs.readFile(path.join(root, "Долгая.base"), "utf8")).toBe(content);
  await page.locator(".tree-file").filter({ hasText: "Вторая" }).click();
  await expect(page.locator(".cm-content")).toContainText("Вторая");
});
test("настройка базы создаёт представление, формулу и фильтр, сохраняя комментарии", async () => {
  await page.evaluate(() =>
    window.veltrite.create(
      "Проекты.base",
      `# Мои проекты\nfilters: 'file.ext == "md"'\nviews:\n  - name: Таблица # комментарий\n    type: table\n    order: [file.name, status]\n`,
    ),
  );
  await page.locator(".tree-file").filter({ hasText: "Проекты" }).click();
  await expect(page.locator(".base-table tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Настроить базу", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Настройка базы" });
  await dialog
    .getByRole("button", { name: "Добавить представление", exact: true })
    .click();
  await dialog.getByLabel("Название представления", { exact: true }).fill("Мои карточки");
  await dialog.getByLabel("Вид представления", { exact: true }).selectOption("cards");
  await dialog.getByRole("button", { name: "Формулы", exact: true }).click();
  await dialog.getByRole("button", { name: "Добавить формулу", exact: true }).click();
  await dialog
    .getByLabel("Выражение формулы новая", { exact: true })
    .fill('html("<strong>Карточка</strong><script>window.BAD=1</script>")');
  await dialog.getByRole("button", { name: "Столбцы", exact: true }).click();
  await dialog.getByRole("button", { name: "formula.новая", exact: true }).click();
  await dialog.getByRole("button", { name: "Фильтры", exact: true }).click();
  await dialog.getByRole("button", { name: "Выражение", exact: true }).last().click();
  await dialog
    .getByLabel("Выражение фильтра", { exact: true })
    .last()
    .fill('status == "active"');
  await dialog
    .getByRole("button", { name: "Сохранить настройки базы", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".base-card")).toHaveCount(1);
  await expect(
    page.locator(".base-card strong").filter({ hasText: "Карточка" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).BAD)).toBeUndefined();
  await expect
    .poll(() => fs.readFile(path.join(root, "Проекты.base"), "utf8"))
    .toContain("# комментарий");
  await page.getByLabel("Представление базы", { exact: true }).selectOption("0");
  await expect(page.locator(".base-table tbody tr")).toHaveCount(2);
});
test("несвязанное упоминание превращается в ссылку на текущую заметку", async () => {
  await page.evaluate(() =>
    window.veltrite.create("Упоминание.md", "Начало — обычный текст."),
  );
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  if (!(await page.locator(".inspector").isVisible()))
    await page.locator(".panel-toggle").click();
  await page.getByRole("button", { name: "Несвязанные упоминания", exact: true }).click();
  const mention = page.locator(".mention-row").filter({ hasText: "Упоминание" });
  await expect(mention).toHaveCount(1);
  await mention.getByRole("button", { name: "Связать", exact: true }).click();
  await expect
    .poll(() => fs.readFile(path.join(root, "Упоминание.md"), "utf8"))
    .toContain("[Начало]");
});
test("закреплённая вкладка остаётся после закрытия остальных и перезапуска", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.locator(".tree-file").filter({ hasText: "Вторая" }).click();
  await page.getByRole("tab", { name: "Начало", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Закрепить вкладку", exact: true }).click();
  await invokeCommand("Закрыть все незакреплённые вкладки");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".pinned-tab")).toContainText("Начало");
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.veltrite.state()).session?.pinned || []),
    )
    .toEqual(["Начало.md"]);
  await application.close();
  await launch();
  await expect(page.locator(".pinned-tab")).toContainText("Начало");
});
test("закладки на заголовок и поиск живут в группах и сохраняются после перезапуска", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await invokeCommand("Добавить заголовок в закладки");
  await page
    .getByRole("dialog", { name: "Палитра команд" })
    .getByRole("button", { name: "План", exact: true })
    .click();
  await expect(page.locator(".bookmark-open")).toContainText("План");
  await page.getByRole("button", { name: "Группа", exact: true }).click();
  await page.getByLabel("Название закладки").fill("Работа");
  await page
    .locator(".bookmark-edit")
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(
    page.locator(".bookmark-open").filter({ hasText: "Работа" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Изменить закладку «План»", exact: true })
    .click();
  const group = await page
    .getByLabel("Переместить закладку в группу")
    .locator("option")
    .filter({ hasText: "Работа" })
    .getAttribute("value");
  await page.getByLabel("Переместить закладку в группу").selectOption(group!);
  await page.getByRole("button", { name: "Сохранить поиск", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Сохранить поисковый запрос" })
    .locator("input")
    .fill("tag:начало");
  await page
    .getByRole("dialog", { name: "Сохранить поисковый запрос" })
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(
    page.locator(".bookmark-open").filter({ hasText: "tag:начало" }),
  ).toBeVisible();
  await page.locator(".bookmark-open").filter({ hasText: "tag:начало" }).click();
  await expect(page.getByLabel("Поиск по содержимому", { exact: true })).toHaveValue(
    "tag:начало",
  );
  await application.close();
  await launch();
  await page.getByRole("button", { name: "Закладки", exact: true }).click();
  await expect(
    page.locator(".bookmark-open").filter({ hasText: "Работа" }),
  ).toBeVisible();
  await page.locator(".bookmark-open").filter({ hasText: "План" }).click();
  await expect(page.locator(".tab.active")).toContainText("Начало");
});
test("извлечение выделения меняет исходную заметку и создаёт рабочую ссылку", async () => {
  await page.evaluate(() =>
    window.veltrite.create("Перенос.md", "Текст для извлечения."),
  );
  await page.locator(".tree-file").filter({ hasText: "Перенос" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+a`);
  await invokeCommand("Создать заметку из выделенного текста");
  await page.getByPlaceholder("Папка/Название заметки").fill("Части/Фрагмент");
  await page.getByRole("button", { name: "Извлечь", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("Фрагмент");
  expect(await fs.readFile(path.join(root, "Части", "Фрагмент.md"), "utf8")).toBe(
    "Текст для извлечения.",
  );
  expect(await fs.readFile(path.join(root, "Перенос.md"), "utf8")).toContain(
    "[Фрагмент]",
  );
  await page.locator(".tree-file").filter({ hasText: "Перенос" }).click();
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await page
    .locator(".reading-pane")
    .getByRole("link", { name: "Фрагмент", exact: true })
    .click();
  await expect(page.locator(".tab.active")).toContainText("Фрагмент");
});
test("горячая клавиша форматирует выделение, отмена работает после переключения чтения", async () => {
  await page.evaluate(() => window.veltrite.create("Формат.md", "Слово"));
  await page.locator(".tree-file").filter({ hasText: "Формат" }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Горячие клавиши", exact: true }).click();
  await page.getByLabel("Найти горячую клавишу").fill("Редактор: Жирный");
  await page
    .locator(".hotkey-row")
    .getByRole("button", { name: "Назначить", exact: true })
    .click();
  await page.keyboard.press("F8");
  await expect(page.locator(".hotkey-row kbd").filter({ hasText: "F8" })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть настройки", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press("F8");
  await expect(page.locator(".cm-content")).toContainText("Слово");
  await expect
    .poll(() => fs.readFile(path.join(root, "Формат.md"), "utf8"))
    .toBe("**Слово**");
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await page.getByRole("button", { name: "Правка", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+z`);
  await expect
    .poll(() => fs.readFile(path.join(root, "Формат.md"), "utf8"))
    .toBe("Слово");
});
test("CSS-сниппет устанавливается, редактируется и отключается в окне настроек", async () => {
  const file = path.join(temp, "Тестовый.css");
  await fs.writeFile(file, "body { --test-snippet: applied; }");
  await application.evaluate(({ dialog }, file) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Добавить сниппет", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--test-snippet").trim(),
      ),
    )
    .toBe("applied");
  await page.getByRole("button", { name: "Править CSS: Тестовый", exact: true }).click();
  await page.getByLabel("Код CSS").fill("body { --test-snippet: edited; }");
  await page.getByRole("button", { name: "Сохранить CSS", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--test-snippet").trim(),
      ),
    )
    .toBe("edited");
  await page.locator(".style-toggle input").uncheck();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--test-snippet").trim(),
      ),
    )
    .toBe("");
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
test("экспорт HTML включает вложения и шрифты, сайт сохраняет вложенные заметки", async () => {
  await fs.writeFile(
    path.join(root, "Точка.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await page.evaluate(async () => {
    await window.veltrite.create(
      "Фрагмент.md",
      "## Встроенный раздел\n\nСодержимое вложенной заметки.",
    );
    await window.veltrite.create(
      "Экспорт.md",
      "# Экспорт\n\n![[Точка.png]]\n\n![[Фрагмент]]\n\n$$E=mc^2$$\n\n> [!note]- Скрытая выноска\n> Текст внутри выноски.\n",
    );
  });
  await page.locator(".tree-file").filter({ hasText: "Экспорт" }).click();
  const output = path.join(temp, "note.html");
  await application.evaluate(({ dialog }, file) => {
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await invokeCommand("Экспортировать заметку в HTML");
  await expect
    .poll(() => fs.readFile(output, "utf8").catch(() => ""), { timeout: 15000 })
    .toContain("data:image/png;base64,");
  const html = await fs.readFile(output, "utf8");
  expect(html).toContain("data:font/woff");
  expect(html).toContain("Содержимое вложенной заметки.");
  expect(html).toContain("Текст внутри выноски.");
  expect(html).not.toContain("veltrite-asset://");
  expect(html).not.toContain('class="heading-fold"');
  const site = path.join(temp, "exported-site");
  await fs.mkdir(site);
  await application.evaluate(({ dialog }, folder) => {
    (dialog as any).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, site);
  await invokeCommand("Опубликовать базу знаний: экспорт сайта");
  await expect
    .poll(
      () => fs.readFile(path.join(site, "notes/Экспорт.html"), "utf8").catch(() => ""),
      { timeout: 15000 },
    )
    .toContain("Содержимое вложенной заметки.");
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
  await expect(page.locator(".canvas-text-preview")).toContainText("Из исходной папки");
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
test("холст: просмотр Markdown, клавиатурная правка, фон группы и концы связей", async () => {
  await fs.writeFile(
    path.join(root, "фон.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await page.evaluate(() =>
    window.veltrite.create(
      "Оформление.canvas",
      JSON.stringify({
        custom: "сохранить",
        nodes: [
          {
            id: "g",
            type: "group",
            x: 0,
            y: 0,
            width: 900,
            height: 500,
            label: "Работа",
          },
          {
            id: "a",
            type: "text",
            x: 40,
            y: 170,
            width: 300,
            height: 230,
            text: "# Заголовок\n\n**Жирный текст** и [[Вторая]].",
          },
          {
            id: "b",
            type: "text",
            x: 550,
            y: 170,
            width: 300,
            height: 230,
            text: "Вторая карточка",
          },
        ],
        edges: [{ id: "e", fromNode: "a", toNode: "b", label: "Переход" }],
      }),
    ),
  );
  await page.locator(".tree-file").filter({ hasText: "Оформление" }).click();
  await expect(page.locator(".canvas-text-preview h1")).toContainText("Заголовок");
  await expect(page.locator(".canvas-text-preview strong")).toContainText("Жирный текст");
  await expect(page.locator(".canvas-node textarea")).toHaveCount(0);
  await page.locator(".canvas-text-preview strong").dblclick();
  await page
    .getByRole("textbox", { name: "Текст карточки", exact: true })
    .fill("## Изменено\n\nСодержимое карточки и [[Вторая]].");
  await page.keyboard.press("Escape");
  await expect(page.locator(".canvas-text-preview h2")).toContainText("Изменено");
  await page.keyboard.press("F2");
  await expect(
    page.getByRole("textbox", { name: "Текст карточки", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByLabel("Название группы", { exact: true }).click();
  await page.getByLabel("Изображение фона группы", { exact: true }).fill("фон.png");
  await page.getByLabel("Режим фона группы", { exact: true }).selectOption("repeat");
  await expect(page.locator(".canvas-node.group")).toHaveCSS(
    "background-repeat",
    "repeat",
  );
  expect(
    await page
      .locator(".canvas-node.group")
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toContain("veltrite-asset://vault/");
  await page.locator(".canvas-edges text").filter({ hasText: "Переход" }).click();
  await page.getByLabel("Стрелка в начале связи", { exact: true }).selectOption("arrow");
  await page.getByLabel("Стрелка в конце связи", { exact: true }).selectOption("none");
  await page.getByLabel("Сторона начала связи", { exact: true }).selectOption("bottom");
  await page.getByLabel("Сторона конца связи", { exact: true }).selectOption("top");
  await expect(page.locator("path.edge")).toHaveAttribute("marker-start", "url(#arrow)");
  await expect(page.locator("path.edge")).not.toHaveAttribute("marker-end");
  await page.keyboard.press(`${modifier}+s`);
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(root, "Оформление.canvas"), "utf8"))
          .edges[0],
    )
    .toMatchObject({
      fromEnd: "arrow",
      toEnd: "none",
      fromSide: "bottom",
      toSide: "top",
    });
  const saved = JSON.parse(
    await fs.readFile(path.join(root, "Оформление.canvas"), "utf8"),
  );
  expect(saved.custom).toBe("сохранить");
  expect(saved.nodes[0]).toMatchObject({
    background: "фон.png",
    backgroundStyle: "repeat",
  });
  expect(saved.nodes[1].text).toContain("## Изменено");
  await page
    .locator(".canvas-text-preview")
    .getByRole("link", { name: "Вторая", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "Вторая", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
    .poll(
      async () =>
        frontmatter(await fs.readFile(path.join(root, "Работа", "Новая.md"), "utf8"))
          .properties.status,
    )
    .toBe("готово");
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
  const trashDialog = page.getByRole("dialog", {
    name: "Переместить в корзину?",
    exact: true,
  });
  await trashDialog.getByRole("button", { name: "В корзину", exact: true }).click();
  await expect(trashDialog).toBeHidden();
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
  expect(await page.locator(".canvas-node").count()).toBeLessThan(300);
  const headerIndex = await page
    .locator(".canvas-node.text .canvas-node-header")
    .evaluateAll((headers) => {
      const bounds = document.querySelector(".canvas-view")!.getBoundingClientRect();
      return headers.findIndex((header) => {
        const rect = header.getBoundingClientRect();
        return (
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          rect.top >= bounds.top + 120 &&
          rect.bottom < bounds.bottom - 60
        );
      });
    });
  expect(headerIndex).toBeGreaterThanOrEqual(0);
  await page.locator(".canvas-node.text .canvas-node-header").nth(headerIndex).click();
  await page.getByTitle("Редактировать карточку", { exact: true }).click();
  await page.locator(".canvas-node textarea").fill("Изменённая карточка");
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
test("расширение переименовывает открытую заметку после сохранения черновика и сохраняет закрепление", async () => {
  const permissions = ["vault.manage"];
  await installScript(
    "rename",
    permissions,
    `export default async api => { await api.commands.register("run", async () => { await api.vault.rename("Начало.md","Перенесённая.md"); }); };`,
  );
  await page.evaluate(
    (permissions) => window.veltrite.togglePlugin("rename", true, permissions as any),
    permissions,
  );
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.getByRole("tab", { name: "Начало", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Закрепить вкладку", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.type(" МОЙ ЧЕРНОВИК");
  await page.evaluate(() => window.veltrite.executePlugin("rename", "run"));
  await expect(page.locator(".pinned-tab")).toContainText("Перенесённая");
  await expect(page.locator(".cm-content")).toContainText("МОЙ ЧЕРНОВИК");
  expect(await fs.readFile(path.join(root, "Перенесённая.md"), "utf8")).toContain(
    "МОЙ ЧЕРНОВИК",
  );
  expect(await fs.readFile(path.join(root, "Вторая.md"), "utf8")).toContain(
    "[[Перенесённая]]",
  );
  await page.evaluate(() => window.veltrite.create("Дополнительная.md", "Текст"));
  await expect(page.locator(".pinned-tab")).toContainText("Перенесённая");
});
test("пример расширения открывает список заметок и переходит к выбранному файлу", async () => {
  const manifest = path.resolve("examples/note-browser/manifest.json"),
    permissions = ["vault.read", "workspace", "ui"];
  await application.evaluate(({ dialog }, file) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, manifest);
  await page.evaluate(() => window.veltrite.installPlugin());
  await page.evaluate(
    (permissions) =>
      window.veltrite.togglePlugin("note-browser", true, permissions as any),
    permissions,
  );
  await page.getByRole("button", { name: "Список заметок", exact: true }).click();
  const view = application
    .windows()
    .find((window) => window.url().startsWith("veltrite-plugin://note-browser/"))!;
  await expect(view.getByRole("heading", { name: "Заметки", exact: true })).toBeVisible();
  await view.getByLabel("Поиск заметок", { exact: true }).fill("Вторая");
  await expect(view.getByRole("button")).toHaveCount(1);
  await view.getByRole("button").click();
  await expect(page.locator(".tab.active")).toContainText("Вторая");
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) =>
            window.webContents.getURL().startsWith("veltrite-plugin://note-browser/"),
          )
          ?.isVisible(),
      ),
    )
    .toBe(false);
});
test("расширение открывает собственный интерфейс, панель и настройки; отключение убирает его кнопки", async () => {
  const permissions = ["ui", "workspace", "vault.read", "editor.read", "storage"];
  await installScript(
    "interface",
    permissions,
    `export default async api => {
    await api.commands.register("run", async () => {
      const notes = await api.metadata.index();
      document.body.replaceChildren();
      const heading = document.createElement("h1"); heading.textContent = "Мои заметки: " + notes.length;
      const button = document.createElement("button"); button.textContent = "Открыть вторую рядом";
      button.onclick = async () => { await api.workspace.open("Вторая.md", { split: "row", mode: "read" }); const context = await api.editor.get(); document.body.dataset.opened = context.path; await api.storage.set("opened", context.path); };
      document.body.append(heading, button); await api.ui.show({ title: "Мой список", width: 640, height: 480 });
    });
    await api.ui.addRibbon({ id: "notes", title: "Мой список", icon: "list", command: "run" });
    await api.ui.status("Мой статус", "run"); await api.ui.registerSettings("run");
  };`,
  );
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.evaluate(
    (permissions) => window.veltrite.togglePlugin("interface", true, permissions as any),
    permissions,
  );
  await page.getByRole("button", { name: "Мой список", exact: true }).click();
  const view = application
    .windows()
    .find((window) => window.url().startsWith("veltrite-plugin://interface/"))!;
  await expect(
    view.getByRole("heading", { name: "Мои заметки: 2", exact: true }),
  ).toBeVisible();
  expect(
    await view.evaluate(() => ({
      node: typeof (window as any).require,
      bridge: typeof window.veltrite,
    })),
  ).toEqual({ node: "undefined", bridge: "undefined" });
  await view.getByRole("button", { name: "Открыть вторую рядом", exact: true }).click();
  await expect(view.locator("body")).toHaveAttribute("data-opened", "Вторая.md");
  await expect(page.locator(".document-leaf")).toHaveCount(2);
  await expect(page.locator(".focused-pane .reading-pane")).toContainText("Вторая");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Расширения", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Настроить", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.veltrite.togglePlugin("interface", false));
  await expect(page.locator(".plugin-ribbon-button")).toHaveCount(0);
  await expect(page.locator(".plugin-statuses")).not.toContainText("Мой статус");
});
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
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("Редактор: исходный код");
  await page.keyboard.press("Enter");
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
  await expect(page.locator(".source-editor")).toBeVisible();
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
  await page
    .getByRole("button", { name: "Дата и время: Вставить дату и время", exact: true })
    .click();
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

test("ссылки на повторяющиеся заголовки прокручивают свою панель, узкие панели сохраняют управление", async () => {
  const encoded = encodeURIComponent("раздел-2");
  const text =
    `# Раздел\n\n[Обычная ссылка](#${encoded})\n\n[[Длинная#${encoded}|Wiki-переход]]\n\n` +
    "Длинный абзац.\n\n".repeat(100) +
    "# Раздел\n\nВторой раздел.\n\n# Раздел-2\n\nКонец.";
  await fs.writeFile(path.join(root, "Длинная.md"), text);
  await page.locator(".tree-file").filter({ hasText: "Длинная" }).click();
  await page.getByRole("button", { name: "Чтение", exact: true }).click();
  await page.getByRole("button", { name: "Разделить вправо", exact: true }).click();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(940, 680),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  const left = page.locator(".document-leaf").nth(0),
    right = page.locator(".document-leaf").nth(1);
  await expect(right.locator(".reading-pane")).toBeVisible();
  expect(
    await right
      .locator(".reading-pane > .markdown")
      .evaluate((root) => [...root.querySelectorAll("h1")].map((heading) => heading.id)),
  ).toEqual(["раздел", "раздел-2", "раздел-2-2"]);
  await right.getByRole("link", { name: "Обычная ссылка", exact: true }).click();
  await expect
    .poll(() => right.locator(".reading-pane").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(300);
  expect(
    await left.locator(".reading-pane").evaluate((element) => element.scrollTop),
  ).toBe(0);
  await right.locator(".reading-pane").evaluate((element) => {
    element.scrollTop = 0;
  });
  await right.getByRole("link", { name: "Wiki-переход", exact: true }).click();
  await expect
    .poll(() => right.locator(".reading-pane").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(300);
  expect(
    await left.locator(".reading-pane").evaluate((element) => element.scrollTop),
  ).toBe(0);
  for (const pane of [left, right]) {
    await expect(pane.getByRole("button", { name: "Правка", exact: true })).toBeVisible();
    await expect(
      pane.getByRole("button", { name: "Закрыть панель", exact: true }),
    ).toBeVisible();
    expect(
      await pane
        .locator(".document-toolbar")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
});

test("большие коллекции и базы разбиты на страницы, итоги считают все отфильтрованные заметки", async () => {
  test.setTimeout(60000);
  await fs.mkdir(path.join(root, "Много"));
  await Promise.all(
    Array.from({ length: 501 }, (_, i) =>
      fs.writeFile(
        path.join(root, "Много", `p${String(i).padStart(4, "0")}.md`),
        `---\nvalue: 1\n---\n# Файл ${i}\n`,
      ),
    ),
  );
  await fs.writeFile(
    path.join(root, "Обзор.base"),
    'filters: file.inFolder("Много")\nviews:\n  - type: table\n    name: Все\n    order: [file.name, value]\n    summaries:\n      value: Sum\n',
  );
  await expect
    .poll(() => page.evaluate(async () => (await window.veltrite.index()).length))
    .toBe(503);
  await page.getByRole("button", { name: "Фильтр файлов", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Текст", exact: true }).click();
  await expect(page.locator(".collection-row")).toHaveCount(200);
  await page.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("201–400 из 503");
  await page
    .getByRole("textbox", { name: "Найти среди файлов", exact: true })
    .fill("p0500");
  await expect(page.locator(".collection-row")).toHaveCount(1);
  await page.keyboard.press(`${modifier}+o`);
  await page.getByPlaceholder("Перейти к файлу…").fill("Обзор");
  await page.keyboard.press("Enter");
  await expect(page.locator(".base-table tbody tr")).toHaveCount(200);
  await expect(page.locator(".base-summary")).toHaveText("501");
  await page.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await page.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(page.locator(".base-table tbody tr")).toHaveCount(101);
  await expect(page.locator(".base-summary")).toHaveText("501");
});

test("расширение снимает регистрацию команды и ограничивает параллельные обращения", async () => {
  await installScript(
    "once",
    ["vault.read", "storage"],
    `export default async api => {
    const remove = await api.commands.register("run", async () => {
      const results = await Promise.allSettled(Array.from({length: 100}, () => api.vault.read("Начало.md")));
      await api.storage.set("requests", {ok: results.filter(r => r.status === "fulfilled").length, rejected: results.filter(r => r.status === "rejected").length});
      await remove();
    });
  };`,
  );
  await page.evaluate(() =>
    window.veltrite.togglePlugin("once", true, ["vault.read", "storage"]),
  );
  expect(
    await page.evaluate(
      async () =>
        (await window.veltrite.plugins()).find((p) => p.id === "once")
          ?.registeredCommands,
    ),
  ).toEqual(["run"]);
  await page.evaluate(() => window.veltrite.executePlugin("once", "run"));
  expect(
    await page.evaluate(
      async () =>
        (await window.veltrite.plugins()).find((p) => p.id === "once")
          ?.registeredCommands,
    ),
  ).toEqual([]);
  const result = JSON.parse(
    await fs.readFile(path.join(temp, "profile", "plugins", "data", "once.json"), "utf8"),
  );
  expect(result.requests.ok).toBeGreaterThan(0);
  expect(result.requests.ok).toBeLessThanOrEqual(16);
  expect(result.requests.ok + result.requests.rejected).toBe(100);
  await expect(
    page.evaluate(() => window.veltrite.executePlugin("once", "run")),
  ).rejects.toThrow("недоступна");
});

test("аудиозапись из синтетического потока сохраняется в заметку и блокирует смену хранилища", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  await page.evaluate(async () => {
    const context = new AudioContext(),
      destination = context.createMediaStreamDestination(),
      tone = context.createOscillator();
    tone.connect(destination);
    tone.start();
    await context.resume();
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => destination.stream,
    });
    (window as any).__audioTest = () => {
      tone.stop();
      return context.close();
    };
  });
  await page.keyboard.press(`${modifier}+p`);
  await page.getByPlaceholder("Найти команду…").fill("Записать аудио");
  await page.keyboard.press("Enter");
  await expect(page.locator(".recording-text")).toBeVisible();
  await page.getByRole("button", { name: "Хранилище: vault", exact: true }).click();
  await page.getByRole("button", { name: "Открыть папку…", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Завершите запись");
  expect(
    await page.evaluate(async () => (await window.veltrite.state()).vault?.root),
  ).toBe(await fs.realpath(root));
  await page.waitForTimeout(300);
  await page.locator(".recording-text").click();
  await expect(page.locator(".recording-text")).toHaveCount(0);
  await expect
    .poll(() => fs.readFile(path.join(root, "Начало.md"), "utf8"))
    .toContain(".webm]]");
  const content = await fs.readFile(path.join(root, "Начало.md"), "utf8"),
    filename = /!\[\[([^\]]+\.webm)\]\]/.exec(content)![1];
  const audio = await fs.readFile(path.join(root, filename));
  expect(audio.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  expect(audio.length).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).__audioTest());
});

test("основной медный акцент адаптируется к тёмной и светлой теме, пользовательский цвет сохраняется", async () => {
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    ),
  ).toBe("#b99871");
  await page.evaluate(() => window.veltrite.preferences({ theme: "light" }));
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      ),
    )
    .toBe("#806342");
  await page.evaluate(() => window.veltrite.preferences({ accent: "#74805a" }));
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      ),
    )
    .toBe("#74805a");
});

test("Enter сразу после фильтра выбирает команду после наведения на другой результат", async () => {
  await page.keyboard.press(`${modifier}+p`);
  await page.locator(".command-list button").nth(5).hover();
  await page.getByPlaceholder("Найти команду…").fill("Открыть корзину");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Корзина", exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Палитра команд", exact: true }),
  ).toHaveCount(0);
});

test("переключения режима редактора не накапливают CSS-правила", async () => {
  await page.locator(".tree-file").filter({ hasText: "Начало" }).click();
  const toggle = async () => {
    await page.getByRole("button", { name: "Чтение", exact: true }).click();
    await page.getByRole("button", { name: "Правка", exact: true }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
  };
  const rules = () =>
    page.evaluate(() =>
      [...document.styleSheets].reduce((total, sheet) => {
        try {
          return total + sheet.cssRules.length;
        } catch {
          return total;
        }
      }, 0),
    );
  await toggle();
  const before = await rules();
  for (let i = 0; i < 12; i++) await toggle();
  expect(await rules()).toBeLessThanOrEqual(before + 4);
});
