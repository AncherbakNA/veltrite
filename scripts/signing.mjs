import { resolve } from "node:path";
/** Optional publisher signing is strict: opting in never falls back to ad-hoc output. */
export function signingConfig(input, environment, platform) {
  const config = { ...input, mac: { ...input.mac }, win: { ...input.win } };
  const macSigned = platform === "mac" && environment.VELTRITE_SIGNED_MAC === "1";
  const winSigned = platform === "win" && environment.VELTRITE_SIGNED_WIN === "1";
  if (macSigned) {
    if (!environment.CSC_LINK)
      throw Error("Для подписи macOS задайте CSC_LINK через секреты сборки");
    const api =
      environment.APPLE_API_KEY &&
      environment.APPLE_API_KEY_ID &&
      environment.APPLE_API_ISSUER;
    const account =
      environment.APPLE_ID &&
      environment.APPLE_APP_SPECIFIC_PASSWORD &&
      environment.APPLE_TEAM_ID;
    if (!api && !account)
      throw Error(
        "Для нотарификации задайте учётные данные Apple API или Apple ID в секретах сборки",
      );
    delete config.mac.identity;
    config.forceCodeSigning = true;
    config.mac.hardenedRuntime = true;
    config.mac.notarize = true;
    config.mac.entitlements = resolve("resources/entitlements.mac.plist");
    config.mac.entitlementsInherit = resolve("resources/entitlements.mac.plist");
  } else {
    config.mac.identity = "-";
    config.mac.hardenedRuntime = false;
    config.mac.notarize = false;
  }
  if (winSigned) {
    if (!environment.CSC_LINK || !environment.VELTRITE_WINDOWS_PUBLISHER)
      throw Error(
        "Для подписи Windows задайте CSC_LINK и VELTRITE_WINDOWS_PUBLISHER через секреты сборки",
      );
    config.forceCodeSigning = true;
    config.win.signExecutable = true;
    config.win.verifyUpdateCodeSignature = true;
    config.win.signtoolOptions = {
      ...config.win.signtoolOptions,
      publisherName: environment.VELTRITE_WINDOWS_PUBLISHER,
      signingHashAlgorithms: ["sha256"],
    };
  } else {
    config.win.signExecutable = false;
    config.win.verifyUpdateCodeSignature = false;
  }
  return config;
}
export function packageVersion(manifest, environment) {
  const candidate = environment.VELTRITE_TEST_PACKAGE_VERSION;
  if (!candidate) return manifest.version;
  if (environment.VELTRITE_TEST_MODE !== "1" || !/^\d+\.\d+\.\d+$/.test(candidate))
    throw Error(
      "Версию тестового установщика можно менять только в изолированном тестовом режиме",
    );
  return candidate;
}
