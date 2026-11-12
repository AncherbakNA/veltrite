const pad = (value: number, size = 2) => String(value).padStart(size, "0");
export function formatDate(date: Date, format: string): string {
  const day = date.getDate(),
    month = date.getMonth() + 1,
    year = date.getFullYear();
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const weekYear = utc.getUTCFullYear(),
    week = Math.ceil(((+utc - +new Date(Date.UTC(weekYear, 0, 1))) / 86400000 + 1) / 7);
  const fields: Record<string, string> = {
    YYYY: String(year),
    YY: String(year).slice(-2),
    GGGG: String(weekYear),
    WW: pad(week),
    W: String(week),
    Q: String(Math.ceil(month / 3)),
    MM: pad(month),
    M: String(month),
    MMMM: date.toLocaleDateString("ru-RU", { month: "long" }),
    MMM: date.toLocaleDateString("ru-RU", { month: "short" }),
    DD: pad(day),
    D: String(day),
    DDD: String(
      Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000),
    ),
    dddd: date.toLocaleDateString("ru-RU", { weekday: "long" }),
    ddd: date.toLocaleDateString("ru-RU", { weekday: "short" }),
    d: String(date.getDay()),
    E: String(date.getDay() || 7),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    hh: pad(date.getHours() % 12 || 12),
    h: String(date.getHours() % 12 || 12),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
    SSS: pad(date.getMilliseconds(), 3),
    A: date.getHours() < 12 ? "AM" : "PM",
    a: date.getHours() < 12 ? "am" : "pm",
    X: String(Math.floor(+date / 1000)),
    x: String(+date),
  };
  return format.replace(
    /\[([^\]]*)\]|GGGG|YYYY|MMMM|dddd|SSS|MMM|DDD|ddd|YY|MM|DD|WW|HH|hh|mm|ss|[QMWDdEHhmsAaXx]/g,
    (token, literal) => (literal === undefined ? fields[token] : literal),
  );
}
export function renderTemplate(
  content: string,
  options: { title: string; date?: Date; dateFormat?: string; timeFormat?: string },
): string {
  const date = options.date || new Date();
  return content.replace(
    /\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/g,
    (_, variable, format) =>
      variable === "title"
        ? options.title
        : formatDate(
            date,
            format?.trim() ||
              (variable === "date"
                ? options.dateFormat || "YYYY-MM-DD"
                : options.timeFormat || "HH:mm"),
          ),
  );
}
