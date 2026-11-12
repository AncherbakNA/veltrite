import { useEffect, useState } from "react";
/** Canvas and native map layers redraw when CSS colors change. */
export function usePaletteVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((value) => value + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return version;
}
