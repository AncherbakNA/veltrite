import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./vault";
export interface LocalConfig {
  recent: { root: string; name: string }[];
  lastVault: string | null;
}
export class ConfigStore {
  constructor(private directory: string) {}
  async read(): Promise<LocalConfig> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.directory, "config.json"), "utf8"),
      );
    } catch (e: any) {
      if (e.code === "ENOENT") return { recent: [], lastVault: null };
      throw Error("Не удалось прочитать настройки приложения");
    }
  }
  async write(value: LocalConfig) {
    await atomicWrite(
      path.join(this.directory, "config.json"),
      JSON.stringify(value, null, 2),
    );
  }
  async saveSecret(id: string, value: unknown) {
    if (!safeStorage.isEncryptionAvailable())
      throw Error(
        "Системное шифрование недоступно. Секреты не будут сохранены открытым текстом.",
      );
    await atomicWrite(
      path.join(this.directory, "secrets", id + ".bin"),
      safeStorage.encryptString(JSON.stringify(value)),
    );
  }
  async readSecret<T>(id: string): Promise<T | null> {
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(this.directory, "secrets", id + ".bin"));
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw Error("Разблокируйте системное хранилище ключей");
    try {
      return JSON.parse(safeStorage.decryptString(data));
    } catch {
      throw Error(
        "Не удалось восстановить вход. Подключите GitHub заново с ключом восстановления.",
      );
    }
  }
  async removeSecret(id: string) {
    await fs.rm(path.join(this.directory, "secrets", id + ".bin"), {
      force: true,
    });
  }
  async readLocal<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.directory, name + ".json"), "utf8"),
      );
    } catch (e: any) {
      if (e.code === "ENOENT") return fallback;
      throw e;
    }
  }
  async writeLocal(name: string, value: unknown) {
    await atomicWrite(path.join(this.directory, name + ".json"), JSON.stringify(value));
  }
}
