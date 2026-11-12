/** @param {import('../../../sdk/veltrite').PluginAPI} api */
export default async function activate(api) {
  await api.commands.register("insert", async () => {
    const note = await api.editor.get();
    const lines = note.content
      .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
      .split("\n");
    let fence = null;
    const headings = [],
      used = new Set();
    for (const line of lines) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker) {
        if (!fence) fence = { char: marker[1][0], length: marker[1].length };
        else if (
          marker[1][0] === fence.char &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = null;
        continue;
      }
      if (fence) continue;
      const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      if (!heading) continue;
      const text = heading[2].replace(/\s+\^[\p{L}\p{N}_-]+\s*$/u, "");
      const base =
        text
          .replace(
            /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
            (_all, target, label) => label || target,
          )
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[*_`~]/g, "")
          .normalize("NFC")
          .trim()
          .toLocaleLowerCase()
          .replace(/\s+/g, "-") || "section";
      let id = base,
        suffix = 2;
      while (used.has(id)) id = base + "-" + suffix++;
      used.add(id);
      const label = text.replace(/[\\[\]]/g, "\\$&");
      headings.push(
        `${"  ".repeat(heading[1].length - 1)}- [${label}](#${encodeURIComponent(id)})`,
      );
    }
    if (!headings.length) {
      await api.notice("В заметке нет заголовков");
      return;
    }
    await api.editor.replaceSelection(headings.join("\n") + "\n");
  });
}
