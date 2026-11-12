import { icons, Puzzle } from "lucide-react";
export default function BaseIcon({ name }: { name: string }) {
  const key = name.replace(/(^|-)([a-z])/g, (_, _dash, letter) => letter.toUpperCase());
  const Icon = icons[key as keyof typeof icons] || Puzzle;
  return <Icon size={17} aria-label={name} />;
}
