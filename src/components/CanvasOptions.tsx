import type { CanvasData, CanvasEdge } from "../../shared/types";

export default function CanvasOptions({
  data,
  selected,
  onChange,
}: {
  data: CanvasData;
  selected: string[];
  onChange: (data: CanvasData) => void;
}) {
  const group = data.nodes.find(
    (node) => node.type === "group" && selected.includes(node.id),
  );
  const edge = data.edges.find((item) => selected.includes(item.id));
  const updateGroup = (values: { background?: string; backgroundStyle?: string }) => {
    if (group)
      onChange({
        ...data,
        nodes: data.nodes.map((node) =>
          node.id === group.id ? { ...node, ...values } : node,
        ),
      });
  };
  const updateEdge = (values: Partial<CanvasEdge>) => {
    if (edge)
      onChange({
        ...data,
        edges: data.edges.map((item) =>
          item.id === edge.id ? { ...item, ...values } : item,
        ),
      });
  };
  return (
    <>
      {group?.type === "group" && (
        <div className="canvas-options">
          <label>
            Фон
            <input
              aria-label="Изображение фона группы"
              placeholder="Вложения/фон.png"
              value={group.background || ""}
              onChange={(event) => updateGroup({ background: event.target.value })}
            />
          </label>
          <label>
            Режим
            <select
              aria-label="Режим фона группы"
              value={group.backgroundStyle || "cover"}
              onChange={(event) => updateGroup({ backgroundStyle: event.target.value })}
            >
              <option value="cover">Заполнить</option>
              <option value="ratio">Вписать</option>
              <option value="repeat">Повторять</option>
            </select>
          </label>
        </div>
      )}
      {edge && (
        <div className="canvas-options">
          <input
            className="edge-label-input"
            aria-label="Подпись связи"
            placeholder="Подпись связи"
            value={edge.label || ""}
            onChange={(event) => updateEdge({ label: event.target.value })}
          />
          {(["from", "to"] as const).map((end) => {
            const endKey = end === "from" ? "fromEnd" : "toEnd";
            const sideKey = end === "from" ? "fromSide" : "toSide";
            return (
              <label key={end}>
                {end === "from" ? "Начало" : "Конец"}
                <select
                  aria-label={
                    end === "from" ? "Стрелка в начале связи" : "Стрелка в конце связи"
                  }
                  value={edge[endKey] || (end === "from" ? "none" : "arrow")}
                  onChange={(event) => updateEdge({ [endKey]: event.target.value })}
                >
                  <option value="none">Без стрелки</option>
                  <option value="arrow">Стрелка</option>
                </select>
                <select
                  aria-label={
                    end === "from" ? "Сторона начала связи" : "Сторона конца связи"
                  }
                  value={edge[sideKey] || (end === "from" ? "right" : "left")}
                  onChange={(event) => updateEdge({ [sideKey]: event.target.value })}
                >
                  <option value="top">Сверху</option>
                  <option value="right">Справа</option>
                  <option value="bottom">Снизу</option>
                  <option value="left">Слева</option>
                </select>
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}
