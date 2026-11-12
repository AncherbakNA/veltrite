/** @param {import('../../../sdk/veltrite').PluginAPI} api */
export default async function activate(api) {
  await api.commands.register("insert", async () => {
    const date = new Date().toLocaleString("ru-RU", {
      dateStyle: "long",
      timeStyle: "short",
    });
    await api.editor.replaceSelection(date);
  });
}
