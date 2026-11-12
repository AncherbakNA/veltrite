import {
  Calendar,
  Clock,
  FileText,
  List,
  Puzzle,
  Search,
  Star,
  Table2,
} from "lucide-react";
import type { PluginInfo } from "../../shared/types";
const icons: Record<string, typeof Puzzle> = {
  calendar: Calendar,
  clock: Clock,
  file: FileText,
  list: List,
  search: Search,
  star: Star,
  table: Table2,
};
export function PluginButtons({
  plugins,
  execute,
}: {
  plugins: PluginInfo[];
  execute: (plugin: string, command: string) => void;
}) {
  return (
    <>
      {plugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
          (plugin.ui?.ribbon || []).map((button) => {
            const Icon = icons[button.icon] || Puzzle;
            return (
              <button
                key={plugin.id + button.id}
                className="plugin-ribbon-button"
                title={plugin.name + ": " + button.title}
                disabled={!plugin.registeredCommands?.includes(button.command)}
                onClick={() => execute(plugin.id, button.command)}
              >
                <Icon size={17} />
                <span>{button.title}</span>
              </button>
            );
          }),
        )}
    </>
  );
}
export function PluginStatus({
  plugins,
  execute,
}: {
  plugins: PluginInfo[];
  execute: (plugin: string, command: string) => void;
}) {
  return (
    <div className="plugin-statuses">
      {plugins
        .filter((plugin) => plugin.enabled && plugin.ui?.status)
        .map((plugin) => {
          const status = plugin.ui!.status!;
          return status.command ? (
            <button
              title={plugin.name}
              key={plugin.id}
              onClick={() => execute(plugin.id, status.command!)}
            >
              {status.text}
            </button>
          ) : (
            <span title={plugin.name} key={plugin.id}>
              {status.text}
            </span>
          );
        })}
    </div>
  );
}
