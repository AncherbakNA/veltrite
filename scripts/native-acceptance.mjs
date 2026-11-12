import { _electron as electron } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { once } from "node:events";
import http from "node:http";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const marker = JSON.parse(await fs.readFile(".veltrite-workspace.json", "utf8"));
if (marker.kind !== "veltrite-development")
  throw Error("Нужна внешняя рабочая папка Veltrite");
const platform = process.argv[2],
  version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
if (
  !["mac", "win"].includes(platform) ||
  (platform === "mac" && process.platform !== "darwin") ||
  (platform === "win" && (process.platform !== "win32" || !process.env.CI))
)
  throw Error("mac проверяется на Mac, win — только на одноразовом Windows CI-агенте");
const directory = resolve(`../native-${platform}-${process.arch}-${version}`),
  ownership = join(directory, ".veltrite-native-acceptance");
const occupied = await fs.access(directory).then(
  () => true,
  () => false,
);
if (occupied) {
  if (
    !(await fs.access(ownership).then(
      () => true,
      () => false,
    ))
  )
    throw Error("Папка нативной проверки занята посторонними файлами");
  await fs.rm(directory, { recursive: true });
}
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(ownership, "synthetic QA only");
const report = {
  version,
  platform,
  architecture: process.arch,
  started: new Date().toISOString(),
  checks: [],
};
function environment(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env))
    if (/^(?:CSC_|WIN_CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$)/.test(key)) delete env[key];
  return env;
}
async function run(file, args = [], options = {}) {
  const child = spawn(file, args, { stdio: "inherit", ...options });
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error(`${basename(file)} завершился с кодом ${code}`);
}
async function waitFor(check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error("Время ожидания нативной проверки истекло");
}
async function digest(file, algorithm = "sha256", encoding = "hex") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
async function smoke(executable, profile, vault, expected, append = "") {
  const app = await electron.launch({
    executablePath: executable,
    args: [],
    env: environment({
      VELTRITE_TEST_MODE: "1",
      VELTRITE_TEST_DATA: profile,
      VELTRITE_TEST_VAULT: vault,
    }),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar");
    const actual = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      arch: process.arch,
    }));
    if (actual.version !== expected || actual.arch !== process.arch)
      throw Error("Версия или архитектура установленного приложения не совпала");
    const text = await page.evaluate(async (append) => {
      const note = await window.veltrite.read("Приёмка.md");
      if (append)
        await window.veltrite.write(note.path, note.content + append, note.revision);
      return note.content;
    }, append);
    if (!text.includes("Синтетическая заметка"))
      throw Error("Заметка не сохранилась после установки");
    report.checks.push({
      name: "Запуск " + expected,
      version: actual.version,
      arch: actual.arch,
    });
  } finally {
    await app.close();
  }
}
async function fullSuite(executable) {
  await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
    env: environment({ VELTRITE_EXECUTABLE: executable }),
  });
  report.checks.push({
    name: "Полный Electron-прогон установленного пакета",
    passed: true,
  });
}
async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("Не удалось получить эталонный релиз");
  const text = await response.text();
  if (text.length > 100000) throw Error("Слишком большой манифест релиза");
  return text;
}
async function download(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw Error("Не удалось загрузить установщик");
  const handle = await fs.open(file, "wx");
  try {
    for await (const chunk of response.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}
const profile = join(directory, "profile"),
  vault = join(directory, "vault");
await fs.mkdir(vault);
await fs.writeFile(join(vault, "Приёмка.md"), "# Приёмка\n\nСинтетическая заметка\n");
try {
  if (platform === "mac") {
    const dmg = resolve(`../releases/Veltrite-${version}-mac-${process.arch}.dmg`),
      mount = join(directory, "volume"),
      applications = join(directory, "Applications");
    await fs.mkdir(applications);
    await fs.mkdir(mount);
    await run("/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mount,
      dmg,
    ]);
    try {
      await run("/usr/bin/ditto", [
        join(mount, "Veltrite.app"),
        join(applications, "Veltrite.app"),
      ]);
    } finally {
      await run("/usr/bin/hdiutil", ["detach", mount]);
    }
    const app = join(applications, "Veltrite.app"),
      executable = join(app, "Contents/MacOS/Veltrite");
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    report.checks.push({
      name: "Установка из DMG и проверка целостности подписи",
      passed: true,
    });
    await smoke(executable, profile, vault, version);
    await fullSuite(executable);
  } else {
    const install = join(directory, "Programs", "Veltrite проверка"),
      oldName = "Veltrite-0.2.1-win-x64.exe",
      old = join(directory, oldName),
      base = "https://github.com/AncherbakNA/veltrite/releases/download/v0.2.1/";
    const sums = await fetchText(base + "SHA256SUMS.txt"),
      expected = sums
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find((parts) => parts[1] === oldName)?.[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected))
      throw Error("Нет контрольной суммы эталонного установщика");
    await download(base + oldName, old);
    if ((await digest(old)) !== expected)
      throw Error("Контрольная сумма эталонного установщика не совпала");
    await run(old, ["/S", "/D=" + install], {
      windowsVerbatimArguments: true,
      env: environment({
        VELTRITE_TEST_MODE: "1",
        VELTRITE_TEST_DATA: profile,
        VELTRITE_TEST_VAULT: vault,
      }),
    });
    const executable = join(install, "Veltrite.exe");
    await waitFor(() =>
      fs.access(executable).then(
        () => true,
        () => false,
      ),
    );
    await smoke(executable, profile, vault, "0.2.1", "Правка перед обновлением\n");
    const current = resolve(`../releases/Veltrite-${version}-win-x64.exe`);
    await run(current, ["/S", "/D=" + install], {
      windowsVerbatimArguments: true,
      env: environment({
        VELTRITE_TEST_MODE: "1",
        VELTRITE_TEST_DATA: profile,
        VELTRITE_TEST_VAULT: vault,
      }),
    });
    await smoke(executable, profile, vault, version);
    await fullSuite(executable);
    const parts = version.split(".").map(Number),
      candidateVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`,
      candidateRoot = resolve("../native-candidate");
    await run(
      process.execPath,
      [join(marker.source, "scripts/workspace.mjs"), "dist:win"],
      {
        cwd: marker.source,
        env: {
          ...process.env,
          VELTRITE_LOCAL_DIR: candidateRoot,
          VELTRITE_TEST_MODE: "1",
          VELTRITE_TEST_PACKAGE_VERSION: candidateVersion,
        },
      },
    );
    const candidate = join(
        candidateRoot,
        "releases",
        `Veltrite-${candidateVersion}-win-x64.exe`,
      ),
      filename = basename(candidate),
      sha512 = await digest(candidate, "sha512", "base64"),
      size = (await fs.stat(candidate)).size;
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.endsWith(".yml")) {
        response.end(
          JSON.stringify({
            version: candidateVersion,
            files: [{ url: filename, sha512, size }],
            path: filename,
            sha512,
            releaseDate: new Date().toISOString(),
          }),
        );
      } else if (url.pathname === "/" + filename) {
        response.setHeader("Content-Length", size);
        createReadStream(candidate).pipe(response);
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let app = null;
    try {
      app = await electron.launch({
        executablePath: executable,
        args: [],
        env: environment({
          VELTRITE_TEST_MODE: "1",
          VELTRITE_TEST_DATA: profile,
          VELTRITE_TEST_VAULT: vault,
          VELTRITE_TEST_UPDATE_URL: `http://127.0.0.1:${server.address().port}/`,
          VELTRITE_TEST_INSTALL_UPDATE: "1",
          VELTRITE_TEST_NO_RELAUNCH: "1",
          VELTRITE_TEST_INSTALL_DIRECTORY: install,
          VELTRITE_TEST_PUBLISHER_NAME:
            process.env.VELTRITE_SIGNED_WIN === "1"
              ? process.env.VELTRITE_WINDOWS_PUBLISHER
              : "",
        }),
      });
      const page = await app.firstWindow();
      await page.waitForSelector(".sidebar");
      const checked = await page.evaluate(() => window.veltrite.checkUpdate());
      if (checked.phase !== "available")
        throw Error(checked.error || "Кандидат обновления не найден");
      const downloaded = await page.evaluate(() => window.veltrite.downloadUpdate());
      if (downloaded.phase !== "ready")
        throw Error(downloaded.error || "Кандидат не загрузился");
      const exited = once(app.process(), "exit");
      await page
        .evaluate(() => window.veltrite.installUpdate())
        .catch((error) => {
          if (!/closed|destroyed/i.test(error.message)) throw error;
        });
      let deadline;
      try {
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(Error("Приложение не завершилось для обновления")),
              30000,
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    } finally {
      await app?.close().catch(() => {});
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    const versionScript = join(
      dirname(fileURLToPath(import.meta.url)),
      "file-version.ps1",
    );
    await waitFor(async () => {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          versionScript,
          "-Executable",
          executable,
        ],
        { encoding: "utf8", env: environment() },
      );
      if (![candidateVersion, candidateVersion + ".0"].includes(result.stdout?.trim()))
        return false;
      const installedAsar = join(install, "resources", "app.asar"),
        candidateAsar = join(
          candidateRoot,
          "releases",
          "win-unpacked",
          "resources",
          "app.asar",
        );
      return (
        (await digest(installedAsar).catch(() => null)) === (await digest(candidateAsar))
      );
    }, 180000);
    await smoke(executable, profile, vault, candidateVersion);
    report.checks.push({
      name: "Автоматическое обновление через NSIS",
      from: version,
      to: candidateVersion,
      passed: true,
    });
    const uninstall = (await fs.readdir(install)).find((name) =>
      /^uninstall.*\.exe$/i.test(name),
    );
    if (!uninstall) throw Error("Деинсталлятор не найден");
    await run(join(install, uninstall), ["/S"], { env: environment() });
    await waitFor(() =>
      fs.access(executable).then(
        () => false,
        () => true,
      ),
    );
    if (
      !(await fs.readFile(join(vault, "Приёмка.md"), "utf8")).includes(
        "Правка перед обновлением",
      )
    )
      throw Error("Удаление приложения изменило заметки");
    await fs.access(join(profile, "config.json"));
    report.checks.push({ name: "Удаление сохраняет профиль и заметки", passed: true });
  }
  report.completed = new Date().toISOString();
  await fs.writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log("Нативная приёмка завершена: " + platform + " " + process.arch);
} catch (error) {
  report.error = error.message;
  await fs.writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  throw error;
}
