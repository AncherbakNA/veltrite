import { expect, test } from "vitest";
// Build configuration is JavaScript so the packaging CLI needs no TypeScript runtime.
// @ts-expect-error CLI module intentionally ships without generated declarations.
import { packageVersion, signingConfig } from "../scripts/signing.mjs";
test("обычная сборка явно остаётся без сертификата издателя", () => {
  const config = signingConfig({ mac: { identity: "-" }, win: {} }, {}, "mac");
  expect(config.mac).toMatchObject({
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
  });
  expect(config.win.signExecutable).toBe(false);
});
test("подпись требует отдельного включения и обязательных реквизитов", () => {
  expect(() => signingConfig({}, { VELTRITE_SIGNED_MAC: "1" }, "mac")).toThrow(
    "CSC_LINK",
  );
  const mac = signingConfig(
    { mac: { identity: "-" } },
    {
      VELTRITE_SIGNED_MAC: "1",
      CSC_LINK: "fixture",
      APPLE_ID: "test@example.test",
      APPLE_APP_SPECIFIC_PASSWORD: "fixture",
      APPLE_TEAM_ID: "FIXTURE",
    },
    "mac",
  );
  expect(mac.forceCodeSigning).toBe(true);
  expect(mac.mac.identity).toBeUndefined();
  expect(mac.mac.notarize).toBe(true);
  const win = signingConfig(
    {},
    {
      VELTRITE_SIGNED_WIN: "1",
      CSC_LINK: "fixture",
      VELTRITE_WINDOWS_PUBLISHER: "Fixture Publisher",
    },
    "win",
  );
  expect(win.win.signtoolOptions.publisherName).toBe("Fixture Publisher");
  expect(win.forceCodeSigning).toBe(true);
});
test("версия кандидата не подменяет обычную сборку", () => {
  expect(packageVersion({ version: "0.3.0" }, {})).toBe("0.3.0");
  expect(() =>
    packageVersion({ version: "0.3.0" }, { VELTRITE_TEST_PACKAGE_VERSION: "0.3.1" }),
  ).toThrow("изолированном");
  expect(
    packageVersion(
      { version: "0.3.0" },
      { VELTRITE_TEST_MODE: "1", VELTRITE_TEST_PACKAGE_VERSION: "0.3.1" },
    ),
  ).toBe("0.3.1");
});
