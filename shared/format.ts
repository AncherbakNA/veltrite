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
