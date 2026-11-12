export interface CatalogAsset {
  file: string;
  size: number;
  sha256: string;
}
export interface CatalogEntry {
  kind: "extension" | "theme";
  id: string;
  name: string;
  description: string;
  version: string;
  revision: string;
  assets: CatalogAsset[];
}
export interface CatalogInfo {
  entries: CatalogEntry[];
  source: "bundled" | "remote";
  error?: string;
}
export function validateCatalog(value: unknown): CatalogEntry[] {
  const data = value as { version: number; entries: CatalogEntry[] };
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.entries) ||
    data.entries.length > 200
  )
    throw Error("Некорректный каталог");
  const ids = new Set<string>();
  return data.entries.map((entry) => {
    if (!entry || typeof entry !== "object") throw Error("Некорректная запись каталога");
    const key = entry.kind + ":" + entry.id;
    if (
      !["extension", "theme"].includes(entry.kind) ||
      typeof entry.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.id) ||
      ids.has(key) ||
      typeof entry.name !== "string" ||
      !entry.name ||
      entry.name.length > 100 ||
      typeof entry.description !== "string" ||
      entry.description.length > 2000 ||
      typeof entry.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(entry.version) ||
      typeof entry.revision !== "string" ||
      !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.revision) ||
      !Array.isArray(entry.assets)
    )
      throw Error("Некорректная запись каталога");
    ids.add(key);
    const expected =
      entry.kind === "extension" ? ["manifest.json", "main.js"] : ["theme.json"];
    if (
      entry.assets.length !== expected.length ||
      expected.some(
        (file) => entry.assets.filter((asset) => asset?.file === file).length !== 1,
      )
    )
      throw Error("Некорректный набор файлов каталога");
    const assets = entry.assets.map((asset) => {
      if (
        !asset ||
        !expected.includes(asset.file) ||
        !Number.isInteger(asset.size) ||
        asset.size < 1 ||
        asset.size > 1024 * 1024 ||
        typeof asset.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(asset.sha256)
      )
        throw Error("Некорректная контрольная сумма каталога");
      return { file: asset.file, size: asset.size, sha256: asset.sha256 };
    });
    return {
      kind: entry.kind,
      id: entry.id,
      name: entry.name,
      description: entry.description,
      version: entry.version,
      revision: entry.revision,
      assets,
    };
  });
}
