/** @param {import('../../sdk/veltrite').PluginAPI} api */
export default async function activate(api) {
  const style = document.createElement("style");
  style.textContent =
    "body{font:14px/1.5 system-ui;padding:16px;color-scheme:light dark}input{width:100%;box-sizing:border-box;padding:8px}button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px;border:1px solid #8885;border-radius:4px;background:transparent;color:inherit;cursor:pointer}small{display:block;opacity:.7}h1{font-size:20px}";
  const title = document.createElement("h1");
  title.textContent = "Заметки";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Имя, папка или тег";
  search.setAttribute("aria-label", "Поиск заметок");
  const status = document.createElement("p"),
    list = document.createElement("div");
  document.head.append(style);
  document.body.replaceChildren(title, search, status, list);
  let notes = [],
    generation = 0;
  function render() {
    const query = search.value.toLocaleLowerCase(),
      matches = notes.filter((note) =>
        [note.path, ...note.tags].join(" ").toLocaleLowerCase().includes(query),
      );
    status.textContent = `${matches.length} заметок${matches.length > 200 ? " · показаны первые 200" : ""}`;
    list.replaceChildren();
    for (const note of matches.slice(0, 200)) {
      const button = document.createElement("button"),
        name = document.createElement("strong"),
        path = document.createElement("small");
      name.textContent = note.title;
      path.textContent = note.path;
      button.append(name, path);
      button.onclick = async () => {
        try {
          await api.workspace.open(note.path);
          await api.ui.hide();
        } catch (error) {
          status.textContent = error.message;
        }
      };
      list.append(button);
    }
  }
  async function refresh() {
    const request = ++generation;
    try {
      const value = await api.metadata.index();
      if (request === generation) {
        notes = value;
        render();
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }
  search.oninput = render;
  await api.commands.register("open", async () => {
    await refresh();
    await api.ui.show({ title: "Список заметок", width: 560, height: 680 });
    search.focus();
  });
  await api.ui.addRibbon({
    id: "notes",
    title: "Список заметок",
    icon: "list",
    command: "open",
  });
  await api.ui.registerSettings("open");
  const off = await api.on("metadata:changed", refresh);
  return () => {
    generation++;
    off();
  };
}
