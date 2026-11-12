import { relativeLink } from "../shared/links";
import { type UnlinkedMention } from "../shared/mentions";
import { runWorker } from "./search";
import { Vault } from "./vault";

export async function unlinkedMentions(
  vault: Vault,
  path: string,
  signal?: AbortSignal,
): Promise<{
  incoming: UnlinkedMention[];
  outgoing: UnlinkedMention[];
  truncated: boolean;
}> {
  const { files, index } = await vault.analysisFiles(),
    current = index.find((note) => note.path === path);
  if (!current) return { incoming: [], outgoing: [], truncated: false };
  const own = await vault.read(path),
    owners = new Map<string, Set<string>>();
  for (const note of index)
    for (const name of [note.title, ...note.aliases]) {
      const key = name.toLocaleLowerCase(),
        values = owners.get(key) || new Set<string>();
      values.add(note.path);
      owners.set(key, values);
    }
  const names = [...new Set([current.title, ...current.aliases])].filter(
    (name) => owners.get(name.toLocaleLowerCase())?.size === 1,
  );
  const targets = [
    ...new Map(
      index
        .filter((note) => note.path !== path)
        .flatMap((note) =>
          [note.title, ...note.aliases]
            .filter((name) => owners.get(name.toLocaleLowerCase())?.size === 1)
            .map(
              (name) => [name.toLocaleLowerCase(), { name, path: note.path }] as const,
            ),
        ),
    ).values(),
  ];
  const outgoingResult = await runWorker<{
    matches: UnlinkedMention[];
    truncated: boolean;
  }>(vault.analysisWorker, { kind: "mentions-outgoing", own, targets }, signal, 5000);
  const incoming: UnlinkedMention[] = [],
    outgoing = outgoingResult.matches;
  let truncated = outgoingResult.truncated,
    bytes = 0,
    batch: import("../shared/types").NoteData[] = [];
  const started = Date.now();
  const flush = async () => {
    if (!batch.length) return;
    const result = await runWorker<Omit<UnlinkedMention, "target">[]>(
      vault.analysisWorker,
      { kind: "mentions-incoming", notes: batch, names, limit: 500 - incoming.length },
      signal,
      3000,
    );
    incoming.push(...result.map((match) => ({ ...match, target: path })));
    batch = [];
    bytes = 0;
  };
  for (const file of files) {
    if (signal?.aborted) throw Error("Поиск упоминаний отменён");
    if (Date.now() - started > 15000 || incoming.length >= 500) {
      truncated = true;
      break;
    }
    if (file.path === path) continue;
    const data = await vault.analysisDocument(file);
    batch.push(data);
    bytes += data.content.length * 2;
    if (batch.length >= 512 || bytes >= 8 * 1024 * 1024) await flush();
  }
  if (incoming.length < 500) await flush();
  incoming.sort((a, b) => a.path.localeCompare(b.path, "ru") || a.from - b.from);
  outgoing.sort((a, b) => a.from - b.from || a.target.localeCompare(b.target, "ru"));
  return { incoming, outgoing, truncated };
}
export async function linkMention(vault: Vault, mention: UnlinkedMention) {
  if (
    !mention ||
    !Number.isInteger(mention.from) ||
    !Number.isInteger(mention.to) ||
    mention.from < 0 ||
    mention.to <= mention.from ||
    typeof mention.text !== "string"
  )
    throw Error("Некорректное упоминание");
  const note = await vault.read(mention.path);
  if (
    note.revision !== mention.revision ||
    note.content.slice(mention.from, mention.to) !== mention.text
  )
    throw Error("Текст изменился. Обновите список упоминаний");
  await vault.read(mention.target);
  const label = mention.text.replace(/[\\[\]]/g, "\\$&");
  return vault.write(
    note.path,
    note.content.slice(0, mention.from) +
      `[${label}](${relativeLink(note.path, mention.target)})` +
      note.content.slice(mention.to),
    note.revision,
  );
}
