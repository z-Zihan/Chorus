import { useEffect, useRef, type DependencyList } from "react";

export interface HotkeyBinding {
  key: string;
  callback: () => void;
}

function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split("+").map((part) => part.trim());
  const key = parts.at(-1);
  const wantsPrimary = parts.includes("ctrl") || parts.includes("meta") || parts.includes("mod");
  const primaryPressed = event.ctrlKey || event.metaKey;

  return Boolean(
    key &&
    event.key.toLowerCase() === key &&
    primaryPressed === wantsPrimary &&
    event.altKey === parts.includes("alt") &&
    event.shiftKey === parts.includes("shift"),
  );
}

export function useHotkey(
  key: string,
  callback: () => void,
  deps: DependencyList = [],
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback, ...deps]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, key)) return;
      event.preventDefault();
      callbackRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [key]);
}

export function useHotkeys(bindings: HotkeyBinding[], deps: DependencyList = []): void {
  const bindingsRef = useRef(bindings);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings, ...deps]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const binding = bindingsRef.current.find((item) => matchesHotkey(event, item.key));
      if (!binding) return;
      event.preventDefault();
      binding.callback();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
