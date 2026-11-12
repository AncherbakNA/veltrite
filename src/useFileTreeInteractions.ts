import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { FileEntry } from "../shared/types";
interface Options {
  visible: FileEntry[];
  collapsed: Set<string>;
  setCollapsed: (value: (old: Set<string>) => Set<string>) => void;
  scroll: RefObject<HTMLDivElement | null>;
  action: (action: string, path: string) => void;
  move: (path: string, destination: string) => void;
}
export function useFileTreeInteractions({
  visible,
  collapsed,
  setCollapsed,
  scroll,
  action,
  move,
}: Options) {
  const [dropFolder, setDropFolder] = useState<string | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    hovering = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const focus = (position: number) => {
    const file = visible[Math.max(0, Math.min(visible.length - 1, position))],
      host = scroll.current;
    if (!file || !host) return;
    const top = position * 28;
    if (top < host.scrollTop || top + 28 > host.scrollTop + host.clientHeight)
      host.scrollTop = Math.max(0, top - host.clientHeight / 2);
    requestAnimationFrame(() =>
      [...host.querySelectorAll<HTMLButtonElement>(".tree-file[data-file-path]")]
        .find((button) => button.dataset.filePath === file.path)
        ?.focus(),
    );
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, file: FileEntry) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const position = visible.findIndex((item) => item.path === file.path),
      folder = file.kind === "folder";
    if (event.key === "ArrowDown") focus(position + 1);
    else if (event.key === "ArrowUp") focus(position - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(visible.length - 1);
    else if (event.key === "ArrowRight") {
      if (folder && collapsed.has(file.path))
        setCollapsed((old) => {
          const next = new Set(old);
          next.delete(file.path);
          return next;
        });
      else if (folder && visible[position + 1]?.path.startsWith(file.path + "/"))
        focus(position + 1);
    } else if (event.key === "ArrowLeft") {
      if (folder && !collapsed.has(file.path))
        setCollapsed((old) => new Set([...old, file.path]));
      else {
        const parent = file.path.split("/").slice(0, -1).join("/"),
          index = visible.findIndex((file) => file.path === parent);
        if (index >= 0) focus(index);
      }
    } else if (event.key === "F2") action("rename", file.path);
    else if (event.key === "Delete" || event.key === "Backspace")
      action("trash", file.path);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const accepts = (event: DragEvent) =>
    event.dataTransfer.types.includes("application/x-veltrite-file");
  const over = (event: DragEvent, folder: string) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropFolder(folder);
    if (hovering.current !== folder) {
      if (timer.current) clearTimeout(timer.current);
      hovering.current = folder;
      if (collapsed.has(folder))
        timer.current = setTimeout(
          () =>
            setCollapsed((old) => {
              const next = new Set(old);
              next.delete(folder);
              return next;
            }),
          650,
        );
    }
  };
  const drop = (event: DragEvent, folder: string) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const from = event.dataTransfer.getData("application/x-veltrite-file"),
      name = from.split("/").at(-1);
    clear();
    if (name && from !== folder && !folder.startsWith(from + "/")) {
      const to = (folder ? folder + "/" : "") + name;
      if (to !== from) move(from, to);
    }
  };
  const clear = () => {
    setDropFolder(null);
    hovering.current = null;
    if (timer.current) clearTimeout(timer.current);
  };
  return { dropFolder, key, over, drop, clear };
}
