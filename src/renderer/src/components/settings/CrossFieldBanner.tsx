import { AlertTriangle } from "lucide-react";
import type { CrossFieldError } from "@/hooks/useCrossFieldErrors";
import { cn } from "@/lib/utils";

interface CrossFieldBannerProps {
  errors: CrossFieldError[];
  className?: string;
}

function focusField(field: string): void {
  const selector = `[data-field-name="${CSS.escape(field)}"]`;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.querySelector<HTMLElement>(
    "input:not([type=hidden]), textarea, select, button:not([aria-label='删除']), [role='combobox'], [role='button'], [tabindex]:not([tabindex='-1'])",
  );
  focusable?.focus();
}

/**
 * Section-top banner that surfaces server-originated validation errors that
 * affect other fields in the same anchor section. Renders nothing when the
 * section is clean.
 */
export function CrossFieldBanner({ errors, className }: CrossFieldBannerProps) {
  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "mb-6 flex items-start gap-3 rounded-[var(--radius-quiet)] border border-destructive/30 bg-destructive/5 px-4 py-3",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-sm font-medium text-destructive">{errors.length} 项配置未完成</div>
        <ul className="space-y-1">
          {errors.map((err) => (
            <li key={err.field} className="flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{err.label}</span>
                <span className="text-muted-foreground"> — {err.message}</span>
              </div>
              <button
                type="button"
                onClick={() => focusField(err.field)}
                className={cn(
                  "shrink-0 rounded-[var(--radius-quiet-sm)] px-2 py-0.5 text-[11px] font-medium",
                  "text-destructive outline-none transition-colors hover:bg-destructive/10",
                  "focus-visible:ring-2 focus-visible:ring-destructive/40",
                )}
              >
                聚焦
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
