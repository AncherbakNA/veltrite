import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
// @ts-expect-error Release CLI intentionally has no generated declaration file.
import { assembleRelease } from "../scripts/release-files.mjs";
test("общий релиз содержит оба Mac ZIP в одной ленте и проверенные контрольные суммы", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-release-")),
    input = path.join(root, "input"),
    output = path.join(root, "output");
  try {
    const targets = {
      "mac-arm64": ["dmg", "zip"],
      "mac-x64": ["dmg", "zip"],
      "win-x64": ["exe", "zip"],
    };
    for (const [target, extensions] of Object.entries(targets)) {
      const directory = path.join(input, target);
      await fs.mkdir(directory, { recursive: true });
      for (const extension of extensions)
        await fs.writeFile(
          path.join(directory, `Veltrite-0.3.0-${target}.${extension}`),
          target + "-" + extension,
        );
    }
    const names = await assembleRelease(input, output, "0.3.0");
    expect(names).toHaveLength(8);
    const mac = JSON.parse(
      await fs.readFile(path.join(output, "latest-mac.yml"), "utf8"),
    );
    expect(mac.files.map((file: { url: string }) => file.url)).toEqual([
      "Veltrite-0.3.0-mac-arm64.zip",
      "Veltrite-0.3.0-mac-x64.zip",
    ]);
    const windows = JSON.parse(
      await fs.readFile(path.join(output, "latest.yml"), "utf8"),
    );
    expect(windows.files[0].sha512).toBe(
      createHash("sha512").update("win-x64-exe").digest("base64"),
    );
    expect(
      (await fs.readFile(path.join(output, "SHA256SUMS.txt"), "utf8")).trim().split("\n"),
    ).toHaveLength(8);
    await fs.mkdir(path.join(input, "duplicate"));
    await fs.writeFile(
      path.join(input, "duplicate", "Veltrite-0.3.0-mac-arm64.zip"),
      "другая сборка",
    );
    await expect(
      assembleRelease(input, path.join(root, "collision"), "0.3.0"),
    ).rejects.toThrow("одинаковое имя");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
