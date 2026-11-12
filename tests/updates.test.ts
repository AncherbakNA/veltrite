import { expect, test } from "vitest";
import { UpdateController, type UpdateDriver } from "../electron/update-controller";
import { compareVersions, type UpdateState } from "../shared/updates";
const noop = () => {};
test("обновление проходит проверку, одну загрузку и явную установку", async () => {
  let progress: (value: number) => void = noop,
    finish!: () => void,
    downloads = 0,
    installed: unknown = null;
  const driver: UpdateDriver = {
    check: async () => ({ version: "2.0.0" }),
    download: () => {
      downloads++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    install: (silent, relaunch) => {
      installed = { silent, relaunch };
    },
    progress: (callback) => {
      progress = callback;
      return noop;
    },
  };
  const states: UpdateState[] = [],
    controller = new UpdateController({
      version: "1.0.0",
      url: "https://example.test/releases",
      driver,
      manualCheck: async () => "1.0.0",
      changed: (state) => states.push(state),
      openManual: async () => {},
    });
  expect((await controller.check()).phase).toBe("available");
  const first = controller.download(),
    second = controller.download();
  expect(first).toBe(second);
  expect(downloads).toBe(1);
  progress(42);
  expect(controller.state().progress).toBe(42);
  expect(installed).toBeNull();
  finish();
  expect((await first).phase).toBe("ready");
  expect(installed).toBeNull();
  await controller.install(true, false);
  expect(installed).toEqual({ silent: true, relaunch: false });
  expect(states.map((state) => state.phase)).toContain("downloading");
});
test("ошибка загрузки не допускает установку, повторная проверка разрешена", async () => {
  const driver: UpdateDriver = {
    check: async () => ({ version: "1.1.0" }),
    download: async () => {
      throw Error("Контрольная сумма не совпала");
    },
    install: () => {
      throw Error("Установка не должна запускаться");
    },
    progress: () => noop,
  };
  const controller = new UpdateController({
    version: "1.0.0",
    url: "",
    driver,
    manualCheck: async () => "1.0.0",
    changed: noop,
    openManual: async () => {},
  });
  await controller.check();
  expect((await controller.download()).phase).toBe("error");
  await expect(controller.install()).rejects.toThrow("загрузите");
  expect((await controller.check()).phase).toBe("available");
});
test("ручное обновление и сравнение версий не допускают понижение", async () => {
  let opened = false;
  const controller = new UpdateController({
    version: "1.9.0",
    url: "https://example.test/releases",
    driver: null,
    manualCheck: async () => "1.10.0",
    changed: noop,
    openManual: async () => {
      opened = true;
    },
  });
  expect((await controller.check()).automatic).toBe(false);
  await expect(controller.download()).rejects.toThrow("ручная");
  await controller.install();
  expect(opened).toBe(true);
  expect(compareVersions("10.0.0", "9.99.9")).toBe(1);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(() => compareVersions("v1.0.0", "1.0.0")).toThrow();
});
