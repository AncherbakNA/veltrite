import { useEffect, useRef } from "react";

/** Keep keyboard navigation inside a dialog and return focus to its trigger. */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const previous = useRef(document.activeElement);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      const target = previous.current;
      if (
        target instanceof HTMLElement &&
        target.isConnected &&
        (document.activeElement === document.body ||
          dialog.contains(document.activeElement))
      )
        target.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
