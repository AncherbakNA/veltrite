/** Russian cardinal forms, including 11–14 and negative counts. */
export function plural(n: number, forms: readonly [string, string, string]) {
  const value = Math.abs(n),
    last = value % 10,
    hundred = value % 100;
  const form =
    Number.isInteger(value) && !(hundred >= 11 && hundred <= 14)
      ? last === 1
        ? 0
        : last >= 2 && last <= 4
          ? 1
          : 2
      : 2;
  return `${n} ${forms[form]}`;
}

export function modifiedAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(seconds) >= size)
      return "Изменено " + formatter.format(Math.round(seconds / size), unit);
  return "Изменено только что";
}
