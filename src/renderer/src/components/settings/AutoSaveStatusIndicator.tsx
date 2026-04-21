import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { AutoSaveStatus } from "@/hooks/useAutoSaveField";
import { cn } from "@/lib/utils";

interface AutoSaveStatusIndicatorProps {
  status: AutoSaveStatus;
  className?: string;
}

/**
 * Compact micro-status chip rendered in each `SettingRow`'s status slot.
 * Quiet by default: renders nothing for `idle` so unchanged rows stay silent.
 */
export function AutoSaveStatusIndicator({ status, className }: AutoSaveStatusIndicatorProps) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        保存中
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600", className)}>
        <Check className="h-3 w-3" />
        已保存
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-destructive", className)}>
      <AlertCircle className="h-3 w-3" />
      未保存
    </span>
  );
}
