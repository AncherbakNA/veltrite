import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
const marker = JSON.parse(await fs.readFile(".veltrite-workspace.json", "utf8"));
if (marker.kind !== "veltrite-development")
  throw Error("Нужна внешняя рабочая папка Veltrite");
const minutes = Number(process.env.VELTRITE_SOAK_MINUTES || 10);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240)
  throw Error("Длительность от 1 до 240 минут");
const directory = path.resolve("../soak", new Date().toISOString().replace(/[:.]/g, "-"));
const root = path.join(directory, "vault"),
  isolated = path.join(directory, "app");
await fs.mkdir(root, { recursive: true });
await fs.mkdir(isolated);
// A snapshot lets ordinary development continue without changing the running test application.
for (const name of ["dist", "dist-electron", "catalog", "package.json"])
  await fs.cp(name, path.join(isolated, name), { recursive: true });
const noteCount = 1500,
  expectedNotes = new Map();
for (let i = 0; i < noteCount; i++) {
  const filename = `n${String(i).padStart(4, "0")}.md`,
    text = `---\nvalue: 1\n---\n# Заметка ${i}\n\n[[n${String((i + 1) % noteCount).padStart(4, "0")}]]\n\nТекст проверки.\n`;
  expectedNotes.set(filename, text);
  await fs.writeFile(path.join(root, filename), text);
}
const canvas = JSON.stringify({
  nodes: Array.from({ length: 5000 }, (_, i) => ({
    id: String(i),
    type: "text",
    text: "Карточка " + i,
    x: (i % 100) * 260,
    y: Math.floor(i / 100) * 180,
    width: 240,
    height: 160,
  })),
  edges: [],
  custom: { keep: true },
});
await fs.writeFile(path.join(root, "Большой.canvas"), canvas);
await fs.writeFile(
  path.join(root, "Обзор.base"),
  'filters: file.ext == "md"\nviews:\n  - type: table\n    name: Все\n    order: [file.name, value]\n    summaries:\n      value: Sum\n',
);
const env = {
  ...process.env,
  VELTRITE_TEST_MODE: "1",
  VELTRITE_TEST_DATA: path.join(directory, "profile"),
  VELTRITE_TEST_VAULT: root,
};
for (const key of Object.keys(env))
  if (/^(?:CSC_|WIN_CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$)/.test(key)) delete env[key];
const app = await electron.launch({
  args: process.env.VELTRITE_EXECUTABLE ? [] : [isolated],
  executablePath: process.env.VELTRITE_EXECUTABLE,
  cwd: process.cwd(),
  env,
});
const report = {
  started: new Date().toISOString(),
  requestedMinutes: minutes,
  platform: os.platform(),
  arch: os.arch(),
  noteCount,
  canvasNodes: 5000,
  cycles: 0,
  samples: [],
  errors: [],
  directory,
};
const start = Date.now(),
  modifier = process.platform === "darwin" ? "Meta" : "Control";
const writeReport = () =>
  fs.writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(
      { ...report, elapsedSeconds: Math.round((Date.now() - start) / 1000) },
      null,
      2,
    ),
  );
let page, cdp;
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.waitForSelector(".sidebar");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 800),
  );
  cdp = await page.context().newCDPSession(page);
  const open = async (name) => {
    await page.keyboard.press(`${modifier}+o`);
    await page.getByPlaceholder("Перейти к файлу…").fill(name);
    await page.keyboard.press("Enter");
  };
  const command = async (name) => {
    await page.keyboard.press(`${modifier}+p`);
    await page.getByPlaceholder("Найти команду…").fill(name);
    await page.keyboard.press("Enter");
  };
  await page.evaluate(async () => {
    await window.veltrite.catalogInstall("extension", "timestamp");
    await window.veltrite.togglePlugin("timestamp", true, ["editor.write"]);
  });
  const sample = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    const processes = await app.evaluate(({ app }) =>
      app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, ...memory })),
    );
    const entry = {
      seconds: Math.round((Date.now() - start) / 1000),
      cycle: report.cycles,
      heapMiB: Math.round((heap.usedSize / 1048576) * 10) / 10,
      processes,
      dom: await page.locator("*").count(),
      tabs: await page.locator(".tab").count(),
      windows: await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    };
    report.samples.push(entry);
    await writeReport();
    console.log(
      `Сеанс: ${entry.seconds} с, циклов ${entry.cycle}, JS после GC ${entry.heapMiB} МиБ, окон ${entry.windows}`,
    );
  };
  let lastSample = -30000;
  while (Date.now() - start < minutes * 60000) {
    const cycle = report.cycles,
      name = `n${String(cycle % 8).padStart(4, "0")}`,
      filename = name + ".md";
    await open(name);
    await command("Редактор: исходный код");
    const text = `---\nvalue: 1\n---\n# Сеанс ${cycle}\n\n[[n1499]]\n\nЦикл ${cycle}.\n`;
    await page.locator(".cm-content").fill(text);
    await page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => fs.readFile(path.join(root, filename), "utf8")).toBe(text);
    expectedNotes.set(filename, text);
    if (cycle % 4 === 0) {
      await command("Разделить панель вправо");
      await expect(page.locator(".document-leaf")).toHaveCount(2);
      await page
        .locator(".document-leaf")
        .last()
        .getByRole("button", { name: "Чтение", exact: true })
        .click();
      await expect(page.locator(".reading-pane")).toBeVisible();
      await page
        .locator(".document-leaf")
        .last()
        .getByRole("button", { name: "Закрыть панель", exact: true })
        .click();
    }
    if (cycle % 5 === 0) {
      await page.evaluate(async () => {
        await window.veltrite.togglePlugin("timestamp", false);
        await window.veltrite.togglePlugin("timestamp", true, ["editor.write"]);
      });
    }
    await page.evaluate(() => window.veltrite.executePlugin("timestamp", "insert"));
    await expect(page.locator(".cm-content")).toContainText(
      String(new Date().getFullYear()),
    );
    await page.keyboard.press(`${modifier}+s`);
    await expect
      .poll(() => fs.readFile(path.join(root, filename), "utf8"))
      .toContain(String(new Date().getFullYear()));
    const saved = await fs.readFile(path.join(root, filename), "utf8");
    if (!saved.includes(`Цикл ${cycle}.`)) throw Error("Расширение потеряло черновик");
    expectedNotes.set(filename, saved);
    await page.getByRole("button", { name: "Чтение", exact: true }).click();
    await page.getByRole("button", { name: "Правка", exact: true }).click();
    await open("Большой");
    await expect(page.locator(".canvas-overview")).toBeVisible();
    await open("Обзор");
    await expect(page.locator(".base-summary")).toHaveText(String(noteCount));
    await expect(page.locator(".base-table tbody tr")).toHaveCount(200);
    if (cycle % 3 === 0) {
      await page.getByRole("button", { name: "Граф знаний", exact: true }).click();
      await expect(page.locator(".graph-canvas")).toBeVisible();
    }
    // Bound open documents: repeated mount/unmount measures retained resources, not tab accumulation.
    while ((await page.locator(".tab-close").count()) > 3)
      await page.locator(".tab-close").first().click();
    report.cycles++;
    if (Date.now() - start - lastSample >= 30000) {
      await sample();
      lastSample = Date.now() - start;
    }
    await page.waitForTimeout(250);
  }
  await sample();
  for (const [filename, text] of expectedNotes)
    if ((await fs.readFile(path.join(root, filename), "utf8")) !== text)
      throw Error("Контроль содержимого: " + filename);
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  if (sha(await fs.readFile(path.join(root, "Большой.canvas"))) !== sha(canvas))
    throw Error("Холст изменился без правки");
  if (report.errors.length) throw Error("Ошибки renderer: " + report.errors.join("; "));
  report.completed = new Date().toISOString();
  report.integrity = { notes: noteCount, canvasNodes: 5000, passed: true };
  const heaps = report.samples.map((sample) => sample.heapMiB);
  report.memory = {
    firstHeapMiB: heaps[0],
    lastHeapMiB: heaps.at(-1),
    peakHeapMiB: Math.max(...heaps),
  };
} catch (error) {
  report.failure = error.message;
  await page?.screenshot({ path: path.join(directory, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeReport();
  await cdp?.detach().catch(() => {});
  await app.close().catch(() => {});
  console.log("Отчёт: " + path.join(directory, "report.json"));
}
