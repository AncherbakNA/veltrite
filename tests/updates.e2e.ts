import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
for (const invalid of [false, true])
  test(
    invalid
      ? "повреждённое обновление отклоняется до установки"
      : "проверенное обновление загружается в изолированный кэш",
    async () => {
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-update-")),
        vault = path.join(temp, "vault");
      await fs.mkdir(vault);
      await fs.writeFile(path.join(vault, "Тест.md"), "# Тест");
      const payload = Buffer.from(
          "MZ — synthetic updater payload; NEVER EXECUTE\n".repeat(2048),
        ),
        filename = "Veltrite-test-99.0.0.exe";
      const sha512 = invalid
        ? Buffer.alloc(64).toString("base64")
        : createHash("sha512").update(payload).digest("base64");
      const metadata = {
        version: "99.0.0",
        files: [{ url: filename, sha512, size: payload.length }],
        path: filename,
        sha512,
        releaseDate: new Date().toISOString(),
      };
      const server = http.createServer((request, response) => {
        const pathname = new URL(request.url!, "http://127.0.0.1").pathname;
        if (pathname.endsWith(".yml")) {
          response.setHeader("Content-Type", "application/yaml");
          response.end(JSON.stringify(metadata));
        } else if (pathname === "/" + filename) {
          response.setHeader("Content-Type", "application/octet-stream");
          response.setHeader("Content-Length", payload.length);
          response.end(payload);
        } else {
          response.statusCode = 404;
          response.end();
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      let application: ElectronApplication | null = null;
      try {
        application = await electron.launch({
          args: process.env.VELTRITE_EXECUTABLE ? [] : ["."],
          executablePath: process.env.VELTRITE_EXECUTABLE,
          cwd: process.cwd(),
          env: {
            ...process.env,
            VELTRITE_TEST_MODE: "1",
            VELTRITE_TEST_INSTALL_UPDATE: "0",
            VELTRITE_TEST_PUBLISHER_NAME: "",
            VELTRITE_TEST_DATA: path.join(temp, "profile"),
            VELTRITE_TEST_VAULT: vault,
            VELTRITE_TEST_UPDATE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
          },
        });
        const page = await application.firstWindow();
        await page.waitForSelector(".sidebar");
        const checked = await page.evaluate(() => window.veltrite.checkUpdate());
        expect(checked, checked.error || "Проверка обновления").toMatchObject({
          phase: "available",
          version: "99.0.0",
          automatic: true,
        });
        let downloaded;
        if (!invalid) {
          await page.keyboard.press(
            `${process.platform === "darwin" ? "Meta" : "Control"}+,`,
          );
          await page.getByRole("button", { name: "О приложении", exact: true }).click();
          await page
            .getByRole("button", { name: "Загрузить 99.0.0", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "Перезапустить и обновить", exact: true }),
          ).toBeVisible();
          downloaded = await page.evaluate(() => window.veltrite.updateState());
        } else downloaded = await page.evaluate(() => window.veltrite.downloadUpdate());
        if (invalid) {
          expect(downloaded.phase).toBe("error");
          expect(downloaded.error).toMatch(/checksum|sha512|Контрольная сумма/i);
        } else {
          expect(downloaded).toMatchObject({ phase: "ready", progress: 100 });
          const updateRoot = path.join(
            temp,
            "profile",
            "update-test",
            "updates",
            "pending",
          );
          const files = await fs.readdir(updateRoot);
          const installer = files.find((file) => file.endsWith(".exe"))!;
          expect(
            createHash("sha512")
              .update(await fs.readFile(path.join(updateRoot, installer)))
              .digest("base64"),
          ).toBe(sha512);
          await page
            .getByRole("button", { name: "Перезапустить и обновить", exact: true })
            .click();
          await expect(page.locator(".toast")).toContainText("тестовом режиме");
          await expect(page.locator(".update-lock")).toHaveCount(0);
        }
      } finally {
        await application?.close().catch(() => {});
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await fs.rm(temp, { recursive: true, force: true });
      }
    },
  );
