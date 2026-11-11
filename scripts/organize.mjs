import ts from "typescript";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, join } from "node:path";
const workspace = resolve("."),
  marker = JSON.parse(readFileSync(".veltrite-workspace.json", "utf8"));
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, workspace);
const versions = new Map();
const host = {
  ...ts.sys,
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (file) => String(versions.get(file) || 0),
  getScriptSnapshot: (file) =>
    existsSync(file)
      ? ts.ScriptSnapshot.fromString(readFileSync(file, "utf8"))
      : undefined,
  getCurrentDirectory: () => workspace,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
};
const service = ts.createLanguageService(host);
let count = 0;
for (const file of parsed.fileNames) {
  for (const edit of service.organizeImports(
    { type: "file", fileName: file },
    { newLineCharacter: "\n" },
    {},
  )) {
    const before = readFileSync(edit.fileName, "utf8"),
      target = join(marker.source, relative(workspace, edit.fileName));
    if (readFileSync(target, "utf8") !== before)
      throw Error(
        "Исходник изменился во время форматирования: " + relative(workspace, file),
      );
    let after = before;
    for (const change of [...edit.textChanges].sort(
      (a, b) => b.span.start - a.span.start,
    ))
      after =
        after.slice(0, change.span.start) +
        change.newText +
        after.slice(change.span.start + change.span.length);
    if (after !== before) {
      writeFileSync(edit.fileName, after);
      writeFileSync(target, after);
      versions.set(edit.fileName, (versions.get(edit.fileName) || 0) + 1);
      count++;
    }
  }
}
service.dispose();
console.log("Упорядочены импорты: " + count);
