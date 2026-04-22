import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import {
  getSettingsSuggestions,
  getVisibleEntries,
  isIdTargetMatch,
  type ParsedSettingsQuery,
  parseSettingsQuery,
  removeToken,
  replaceLastToken,
  type SettingsSuggestion,
  valuesEqual,
} from "./settingsFilter";
import { FIELD_KEYS, FIELD_REGISTRY, type FieldAnchor, type FieldEntry, flattenConfig } from "./settingsRegistry";

interface SettingsSearchContextValue {
  query: string;
  setQuery: (value: string) => void;
  parsedQuery: ParsedSettingsQuery;
  hasActiveFilters: boolean;
  resultCount: number;
  firstMatch: FieldEntry | null;
  suggestions: SettingsSuggestion[];
  showAdvanced: boolean;
  isAdvancedVisible: boolean;
  isAdvancedTokenActive: boolean;
  toggleShowAdvanced: () => void;
  clearAdvancedToken: () => void;
  applySuggestion: (suggestion: SettingsSuggestion) => void;
  isFieldVisible: (key: string) => boolean;
  isFieldHighlighted: (key: string) => boolean;
  isFieldModified: (key: string) => boolean;
  isFieldIdTargeted: (key: string) => boolean;
  isAnchorVisible: (anchor: FieldAnchor) => boolean;
  focusFirstMatch: () => void;
  registerMountedField: (key: string) => () => void;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | null>(null);

function focusFieldInDom(field: string): boolean {
  const selector = `[data-field-name="${CSS.escape(field)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return false;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = element.querySelector<HTMLElement>(
    "input:not([type=hidden]), textarea, select, button, [role='combobox'], [role='button'], [tabindex]:not([tabindex='-1'])",
  );
  focusable?.focus();
  return true;
}

interface SettingsSearchProviderProps {
  children: ReactNode;
  defaultConfig: Record<string, unknown>;
  defaultConfigReady?: boolean;
}

export function SettingsSearchProvider({
  children,
  defaultConfig,
  defaultConfigReady = false,
}: SettingsSearchProviderProps) {
  const form = useFormContext<FieldValues>();
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mountedFields, setMountedFields] = useState<Set<string>>(() => new Set());
  const deferredQuery = useDeferredValue(query);
  const watchedValues = useWatch({
    control: form.control,
    name: FIELD_KEYS,
  }) as unknown[];

  const defaultValues = useMemo(() => flattenConfig(defaultConfig), [defaultConfig]);
  const parsedQuery = useMemo(() => parseSettingsQuery(deferredQuery), [deferredQuery]);
  const suggestions = useMemo(() => getSettingsSuggestions(query), [query]);

  const modifiedKeys = useMemo(() => {
    if (!defaultConfigReady) {
      return new Set<string>();
    }

    const next = new Set<string>();
    for (const [index, key] of FIELD_KEYS.entries()) {
      if (!valuesEqual(watchedValues[index], defaultValues[key])) {
        next.add(key);
      }
    }
    return next;
  }, [defaultConfigReady, defaultValues, watchedValues]);

  const registerMountedField = useCallback((key: string) => {
    setMountedFields((previous) => {
      if (previous.has(key)) {
        return previous;
      }

      const next = new Set(previous);
      next.add(key);
      return next;
    });

    return () => {
      setMountedFields((previous) => {
        if (!previous.has(key)) {
          return previous;
        }

        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    };
  }, []);

  const availableEntries = useMemo(
    () => (mountedFields.size > 0 ? FIELD_REGISTRY.filter((entry) => mountedFields.has(entry.key)) : FIELD_REGISTRY),
    [mountedFields],
  );

  const visibleEntries = useMemo(
    () =>
      getVisibleEntries(availableEntries, {
        parsedQuery,
        showAdvanced,
        modifiedKeys,
      }),
    [availableEntries, modifiedKeys, parsedQuery, showAdvanced],
  );

  const visibleKeySet = useMemo(() => new Set(visibleEntries.map((entry) => entry.key)), [visibleEntries]);
  const visibleAnchorSet = useMemo(() => new Set(visibleEntries.map((entry) => entry.anchor)), [visibleEntries]);
  const firstMatch = visibleEntries[0] ?? null;
  const hasActiveFilters = parsedQuery.hasFilters;
  const isAdvancedTokenActive = parsedQuery.advanced;
  const isAdvancedVisible = showAdvanced || isAdvancedTokenActive;

  const applySuggestion = useCallback((suggestion: SettingsSuggestion) => {
    setQuery((previous) => replaceLastToken(previous, suggestion.insertValue));
  }, []);

  const clearAdvancedToken = useCallback(() => {
    setQuery((previous) => removeToken(previous, "@advanced"));
  }, []);

  const focusFirstMatch = useCallback(() => {
    for (const entry of visibleEntries) {
      if (focusFieldInDom(entry.key)) {
        return;
      }
    }
  }, [visibleEntries]);

  const isFieldVisible = useCallback((key: string) => visibleKeySet.has(key), [visibleKeySet]);
  const isFieldHighlighted = useCallback(
    (key: string) => hasActiveFilters && visibleKeySet.has(key),
    [hasActiveFilters, visibleKeySet],
  );
  const isFieldModified = useCallback((key: string) => modifiedKeys.has(key), [modifiedKeys]);
  const isFieldIdTargeted = useCallback(
    (key: string) => {
      const entry = FIELD_REGISTRY.find((item) => item.key === key);
      return entry ? isIdTargetMatch(entry, parsedQuery) : false;
    },
    [parsedQuery],
  );
  const isAnchorVisible = useCallback((anchor: FieldAnchor) => visibleAnchorSet.has(anchor), [visibleAnchorSet]);

  useEffect(() => {
    if (showAdvanced && isAdvancedTokenActive) {
      setShowAdvanced(false);
    }
  }, [isAdvancedTokenActive, showAdvanced]);

  const value = useMemo<SettingsSearchContextValue>(
    () => ({
      query,
      setQuery,
      parsedQuery,
      hasActiveFilters,
      resultCount: visibleEntries.length,
      firstMatch,
      suggestions,
      showAdvanced,
      isAdvancedVisible,
      isAdvancedTokenActive,
      toggleShowAdvanced: () => setShowAdvanced((current) => !current),
      clearAdvancedToken,
      applySuggestion,
      isFieldVisible,
      isFieldHighlighted,
      isFieldModified,
      isFieldIdTargeted,
      isAnchorVisible,
      focusFirstMatch,
      registerMountedField,
    }),
    [
      applySuggestion,
      clearAdvancedToken,
      firstMatch,
      focusFirstMatch,
      hasActiveFilters,
      isAdvancedTokenActive,
      isAdvancedVisible,
      isAnchorVisible,
      isFieldHighlighted,
      isFieldIdTargeted,
      isFieldModified,
      isFieldVisible,
      parsedQuery,
      query,
      registerMountedField,
      showAdvanced,
      suggestions,
      visibleEntries.length,
    ],
  );

  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

export function useSettingsSearch(): SettingsSearchContextValue {
  const context = useContext(SettingsSearchContext);
  if (!context) {
    throw new Error("useSettingsSearch must be used within <SettingsSearchProvider>");
  }
  return context;
}

export function useOptionalSettingsSearch(): SettingsSearchContextValue | null {
  return useContext(SettingsSearchContext);
}
