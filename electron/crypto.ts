import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
const MAGIC = Buffer.from("VELTRITE\0\x01");
export function newRecoveryKey() {
  return "vlt1_" + randomBytes(32).toString("base64url");
}
export function parseRecoveryKey(value: string) {
  if (!/^vlt1_[A-Za-z0-9_-]{43}$/.test(value))
    throw Error("Некорректный ключ восстановления");
  const key = Buffer.from(value.slice(5), "base64url");
  if (key.length !== 32) throw Error("Некорректный ключ");
  return key;
}
export function encrypt(data: Buffer, key: Buffer, context: string): Buffer {
  if (key.length !== 32) throw Error("Некорректный ключ");
  const salt = randomBytes(32),
    nonce = randomBytes(12),
    header = Buffer.concat([MAGIC, salt, nonce]);
  const derived = Buffer.from(hkdfSync("sha256", key, salt, Buffer.from(context), 32));
  const cipher = createCipheriv("aes-256-gcm", derived, nonce);
  cipher.setAAD(Buffer.concat([header, Buffer.from(context)]));
  return Buffer.concat([
    header,
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function decrypt(data: Buffer, key: Buffer, context: string): Buffer {
  if (
    key.length !== 32 ||
    data.length < MAGIC.length + 60 ||
    !data.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw Error("Неподдерживаемый формат зашифрованных данных");
  const offset = MAGIC.length,
    header = data.subarray(0, offset + 44);
  const derived = Buffer.from(
    hkdfSync("sha256", key, data.subarray(offset, offset + 32), Buffer.from(context), 32),
  );
  try {
    const cipher = createDecipheriv(
      "aes-256-gcm",
      derived,
      data.subarray(offset + 32, offset + 44),
    );
    cipher.setAAD(Buffer.concat([header, Buffer.from(context)]));
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([
      cipher.update(data.subarray(offset + 44, -16)),
      cipher.final(),
    ]);
  } catch {
    throw Error("Не удалось расшифровать данные. Проверьте ключ восстановления.");
  }
}
