import { createContext, useContext } from "react";
export const TaskContext = createContext<{ offset: number | null; label: string }>({
  offset: null,
  label: "Задача",
});
export default function ReadingTask({
  checked,
  onChange,
}: {
  checked?: boolean;
  onChange?: (offset: number, checked: boolean) => void;
}) {
  const task = useContext(TaskContext);
  return (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={!onChange || task.offset === null}
      aria-label={task.label}
      onChange={(e) => {
        if (task.offset !== null) onChange?.(task.offset, e.target.checked);
      }}
    />
  );
}
