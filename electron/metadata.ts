import { editFrontmatter, type PropertyChange } from "../shared/frontmatter-edit";
import type { NoteData } from "../shared/types";
import { Vault } from "./vault";
export async function updateProperties(
  vault: Vault,
  paths: string[],
  change: PropertyChange,
): Promise<number> {
  if (
    !Array.isArray(paths) ||
    paths.length > 50000 ||
    !change ||
    typeof change !== "object" ||
    JSON.stringify(change).length > 262144
  )
    throw Error("Слишком большая операция со свойствами");
  const edits: { before: NoteData; content: string; written?: string }[] = [];
  let bytes = 0;
  for (const path of new Set(paths)) {
    if (typeof path !== "string" || !/\.md$/i.test(path))
      throw Error("Свойства доступны для заметок Markdown");
    const before = await vault.read(path),
      content = editFrontmatter(before.content, change);
    if (content !== before.content) {
      bytes += before.content.length * 2 + content.length * 2;
      if (bytes > 128 * 1024 * 1024)
        throw Error("Выберите меньше заметок для одной операции");
      edits.push({ before, content });
    }
  }
  try {
    for (const edit of edits)
      edit.written = (
        await vault.write(edit.before.path, edit.content, edit.before.revision)
      ).revision;
  } catch (error) {
    const conflicts: string[] = [];
    for (const edit of edits.filter((item) => item.written).reverse())
      try {
        await vault.write(edit.before.path, edit.before.content, edit.written);
      } catch {
        conflicts.push(edit.before.path);
      }
    if (conflicts.length)
      throw Error(
        "Операция прервана из-за внешних правок. Проверьте историю: " +
          conflicts.join(", "),
      );
    throw error;
  }
  return edits.length;
}
