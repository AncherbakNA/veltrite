import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { Vault } from "../electron/vault";
import { mapLimit } from "../electron/concurrency";
import { buildGraph } from "../shared/graph";

async function main() {
  const marker = JSON.parse(await fs.readFile(".veltrite-workspace.json", "utf8"));
  if (marker.kind !== "veltrite-development") throw Error("Нужна внешняя рабочая папка");
  const count = Number(process.env.VELTRITE_BENCH_NOTES || 10000);
  if (!Number.isInteger(count) || count < 100 || count > 40000)
    throw Error("От 100 до 40000 заметок");
  const directory = path.resolve(
    "../benchmarks",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await fs.mkdir(directory, { recursive: true });
  const root = path.join(directory, "vault");
  await fs.mkdir(root);
  const metrics: Record<string, unknown>[] = [];
  const measure = async <T>(name: string, work: () => T | Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await work();
    metrics.push({
      name,
      milliseconds: Math.round(performance.now() - start),
      rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    });
    return result;
  };
  await measure("Генерация", async () => {
    for (let folder = 0; folder < Math.ceil(count / 100); folder++)
      await fs.mkdir(path.join(root, "Папка-" + folder));
    await mapLimit(
      Array.from({ length: count }, (_, i) => i),
      16,
      async (i) => {
        const link = (i + 1) % count;
        await fs.writeFile(
          path.join(root, `Папка-${Math.floor(i / 100)}`, `n${i}.md`),
          `---\ntags: [проверка]\nscore: ${i}\n---\n# Заметка ${i}\n\n[[Папка-${Math.floor(link / 100)}/n${link}]]\n\n` +
            "Текст синтетической заметки для проверки поиска и индекса. ".repeat(10),
        );
      },
    );
  });
  const vault = new Vault(root);
  await measure("Открытие и список", () => vault.open());
  const index = await measure("Холодный индекс", () => vault.index());
  await measure("Повторный индекс", () => vault.index());
  const query = `[score:>=${count - 10}] content:синтетической`;
  const first = await measure("Первый поиск", () => vault.search(query));
  if (first.length !== 10) throw Error("Поиск потерял результаты: " + first.length);
  await measure("Повторный поиск", () => vault.search(query));
  const graph = await measure("Связи графа", () => buildGraph(index, "", false, null));
  if (graph.nodes.length !== count || graph.edges.length !== count)
    throw Error("Граф потерял узлы или связи");
  const target = await vault.read("Папка-0/n0.md");
  await vault.write(
    target.path,
    target.content + "\nИзменение индекса\n",
    target.revision,
  );
  const changed = await measure("Индекс после одной правки", () => vault.index());
  if (!changed.find((note) => note.path === target.path)?.words)
    throw Error("Правка не попала в индекс");
  const report = {
    count,
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0].model,
    created: new Date().toISOString(),
    directory,
    metrics,
  };
  await fs.writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
