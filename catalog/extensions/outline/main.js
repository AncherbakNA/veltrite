/** @param {import('../../../sdk/veltrite').PluginAPI} api */
export default async function activate(api) {
  await api.commands.register("insert", async () => {
    const note = await api.editor.get();
    let fence = null;
    const headings = [];
    for (const line of note.content.split("\n")) {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1][0];
      if (marker) {
        fence = fence === marker ? null : marker;
        continue;
      }
      if (fence) continue;
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading)
        headings.push(
          `${"  ".repeat(heading[1].length - 1)}- [[#${heading[2]}|${heading[2]}]]`,
        );
    }
    if (!headings.length) {
      await api.notice("В заметке нет заголовков");
      return;
    }
    await api.editor.replaceSelection(headings.join("\n") + "\n");
  });
}
