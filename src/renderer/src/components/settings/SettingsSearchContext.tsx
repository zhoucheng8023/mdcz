import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { FIELD_REGISTRY, type FieldEntry } from "./settingsRegistry";

interface SettingsSearchContextValue {
  query: string;
  setQuery: (value: string) => void;
  normalizedQuery: string;
  /** True when the query is non-empty — callers can use this to trigger dimming */
  isSearching: boolean;
  /** Whether a given label or key matches the current query (case-insensitive substring) */
  isMatch: (label: string, key: string) => boolean;
  /** First registry entry whose label matches the current query, or null */
  firstMatch: FieldEntry | null;
  /** Jump + focus the first matching field in the DOM */
  focusFirstMatch: () => void;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | null>(null);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function focusFieldInDom(field: string): void {
  const selector = `[data-field-name="${CSS.escape(field)}"]`;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.querySelector<HTMLElement>(
    "input:not([type=hidden]), textarea, select, button, [role='combobox'], [role='button'], [tabindex]:not([tabindex='-1'])",
  );
  focusable?.focus();
}

interface SettingsSearchProviderProps {
  children: ReactNode;
}

export function SettingsSearchProvider({ children }: SettingsSearchProviderProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalize(query);
  const isSearching = normalizedQuery.length > 0;

  const isMatch = useCallback(
    (label: string, key: string): boolean => {
      if (normalizedQuery.length === 0) return true;
      return label.toLowerCase().includes(normalizedQuery) || key.toLowerCase().includes(normalizedQuery);
    },
    [normalizedQuery],
  );

  const firstMatch = useMemo<FieldEntry | null>(() => {
    if (normalizedQuery.length === 0) return null;
    return (
      FIELD_REGISTRY.find(
        (entry) =>
          entry.label.toLowerCase().includes(normalizedQuery) || entry.key.toLowerCase().includes(normalizedQuery),
      ) ?? null
    );
  }, [normalizedQuery]);

  const focusFirstMatch = useCallback(() => {
    if (!firstMatch) return;
    focusFieldInDom(firstMatch.key);
  }, [firstMatch]);

  const value = useMemo<SettingsSearchContextValue>(
    () => ({
      query,
      setQuery,
      normalizedQuery,
      isSearching,
      isMatch,
      firstMatch,
      focusFirstMatch,
    }),
    [query, normalizedQuery, isSearching, isMatch, firstMatch, focusFirstMatch],
  );

  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

export function useSettingsSearch(): SettingsSearchContextValue {
  const ctx = useContext(SettingsSearchContext);
  if (!ctx) {
    throw new Error("useSettingsSearch must be used within <SettingsSearchProvider>");
  }
  return ctx;
}

/** Non-throwing variant for components that can render outside the provider (tests, e.g.). */
export function useOptionalSettingsSearch(): SettingsSearchContextValue | null {
  return useContext(SettingsSearchContext);
}
