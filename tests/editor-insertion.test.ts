import { expect, test, vi } from "vitest";
import { insertIntoEditor, registerEditorInsertion } from "../src/editorInsertion";
test("вставка дожидается монтирования нужного редактора, соседняя панель её не получает", async () => {
  const values: string[] = [],
    request = insertIntoEditor("Тест.md", "right", "Текст");
  const left = registerEditorInsertion("Тест.md", "left", () => {
    throw Error("Не та панель");
  });
  const right = registerEditorInsertion("Тест.md", "right", (text) => values.push(text));
  await request;
  expect(values).toEqual(["Текст"]);
  await insertIntoEditor("Тест.md", "right", "Ещё");
  expect(values).toEqual(["Текст", "Ещё"]);
  left();
  right();
});
test("закрытая панель отклоняет ожидающую вставку и освобождает её", async () => {
  vi.useFakeTimers();
  try {
    const request = insertIntoEditor("Закрытая.md", "closed", "Текст");
    const rejected = expect(request).rejects.toThrow("Не удалось открыть редактор");
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    const insert = vi.fn(),
      off = registerEditorInsertion("Закрытая.md", "closed", insert);
    expect(insert).not.toHaveBeenCalled();
    off();
  } finally {
    vi.useRealTimers();
  }
});
