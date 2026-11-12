import { useRef } from "react";
import { stringify } from "yaml";
import type { PropertyType } from "../../shared/properties";
import { propertyType } from "../../shared/properties";
import { formatDate } from "../../shared/templates";
export default function PropertyField({
  name,
  value,
  type,
  onChange,
}: {
  name: string;
  value: unknown;
  type?: PropertyType;
  onChange: (value: string, type?: PropertyType) => void;
}) {
  const edited = useRef(false),
    effective = type || propertyType(value);
  if (effective === "checkbox")
    return (
      <input
        aria-label={"Свойство " + name}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(String(event.target.checked), "checkbox")}
      />
    );
  const formatted = Array.isArray(value)
    ? JSON.stringify(value)
    : value && typeof value === "object"
      ? stringify(value, { flowCollectionPadding: false }).trim()
      : value == null
        ? ""
        : effective === "datetime" && Number.isFinite(+new Date(String(value)))
          ? formatDate(new Date(String(value)), "YYYY-MM-DD[T]HH:mm")
          : String(value);
  return (
    <input
      aria-label={"Свойство " + name}
      type={
        effective === "number"
          ? "number"
          : effective === "date"
            ? "date"
            : effective === "datetime"
              ? "datetime-local"
              : effective === "url"
                ? "url"
                : "text"
      }
      step={effective === "number" ? "any" : undefined}
      defaultValue={formatted}
      onChange={() => {
        edited.current = true;
      }}
      onBlur={(event) => {
        const changed = edited.current;
        edited.current = false;
        if (changed && event.target.value !== formatted)
          onChange(
            event.target.value,
            type ||
              (effective === "list" || effective === "tags" ? effective : undefined),
          );
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          edited.current = false;
          event.currentTarget.value = formatted;
          event.currentTarget.blur();
          event.stopPropagation();
        }
      }}
    />
  );
}
