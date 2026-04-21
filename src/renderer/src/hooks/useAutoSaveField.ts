import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { unflattenConfig } from "@/components/settings/settingsRegistry";
import { useSettingsSavingStore } from "@/store/settingsSavingStore";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveFieldOptions {
  /**
   * "debounce": wait debounceMs after the last change before saving (free-text).
   * "immediate": save as soon as the value differs from the last saved value (discrete controls).
   */
  mode?: "debounce" | "immediate";
  debounceMs?: number;
}

export interface UseAutoSaveFieldResult {
  status: AutoSaveStatus;
  error: string | null;
}

const DEFAULT_DEBOUNCE_MS = 500;
const SAVED_FADE_MS = 1500;

interface ServerValidationPayload {
  fields: string[];
  fieldErrors: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function extractServerValidation(error: unknown): ServerValidationPayload | null {
  if (!isRecord(error)) return null;
  const details = isRecord(error.details) ? error.details : undefined;
  const rootFields = toStringArray(error.fields);
  const rootFieldErrors = toStringRecord(error.fieldErrors);
  const fields = rootFields.length > 0 ? rootFields : toStringArray(details?.fields);
  const fieldErrors = Object.keys(rootFieldErrors).length > 0 ? rootFieldErrors : toStringRecord(details?.fieldErrors);

  if (fields.length === 0 && Object.keys(fieldErrors).length === 0) {
    return null;
  }

  const mergedFields = new Set<string>(fields);
  for (const key of Object.keys(fieldErrors)) {
    mergedFields.add(key);
  }

  return { fields: [...mergedFields], fieldErrors };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Auto-saves a single form field to the backend via `ipc.config.save`.
 *
 * - Observes the field value via react-hook-form's `useWatch`.
 * - Debounces free-text edits (mode="debounce") or saves immediately for
 *   discrete controls (Switch, Select, pickers, chip add/remove, etc.).
 * - Exposes a per-field status machine: `idle | saving | saved | error`.
 * - On validation failure, records server errors via `form.setError` so both
 *   the field's inline message and the section-level `CrossFieldBanner`
 *   (driven by `useCrossFieldErrors`) stay in sync.
 * - Tracks in-flight saves in a shared store so the route can guard profile
 *   switches until pending writes settle.
 */
export function useAutoSaveField(path: string, options: UseAutoSaveFieldOptions = {}): UseAutoSaveFieldResult {
  const { mode = "immediate", debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const form = useFormContext();
  const value = useWatch({ control: form.control, name: path });

  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const formRef = useRef(form);
  formRef.current = form;

  const debounceTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingValueRef = useRef<unknown>(value);
  const lastSavedValueRef = useRef<unknown>(value);

  const incrementInFlight = useSettingsSavingStore((state) => state.incrementInFlight);
  const decrementInFlight = useSettingsSavingStore((state) => state.decrementInFlight);

  useEffect(() => {
    pendingValueRef.current = value;

    if (valuesEqual(value, lastSavedValueRef.current)) {
      return;
    }

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    const performSave = () => {
      const valueToSave = pendingValueRef.current;
      setStatus("saving");
      setError(null);
      incrementInFlight();

      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(async () => {
          try {
            const payload = unflattenConfig({ [path]: valueToSave });
            await ipc.config.save(payload);
            lastSavedValueRef.current = valueToSave;
            setStatus("saved");
            setError(null);
            formRef.current.clearErrors(path);

            fadeTimerRef.current = window.setTimeout(() => {
              fadeTimerRef.current = null;
              setStatus((current) => (current === "saved" ? "idle" : current));
            }, SAVED_FADE_MS);
          } catch (err) {
            const serverError = extractServerValidation(err);
            if (serverError) {
              const ownError = serverError.fieldErrors[path];
              if (ownError) {
                setError(ownError);
                formRef.current.setError(path, { type: "server", message: ownError });
              } else {
                setError(null);
                formRef.current.clearErrors(path);
              }
              for (const otherField of serverError.fields) {
                if (otherField === path) continue;
                const message = serverError.fieldErrors[otherField] ?? "校验失败";
                formRef.current.setError(otherField, { type: "server", message });
              }
            } else {
              const message = err instanceof Error ? err.message : "保存失败";
              setError(message);
              formRef.current.setError(path, { type: "server", message });
            }
            setStatus("error");
          } finally {
            decrementInFlight();
          }
        });
    };

    if (mode === "immediate") {
      performSave();
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      performSave();
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [value, mode, debounceMs, path, incrementInFlight, decrementInFlight]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
    };
  }, []);

  return { status, error };
}
