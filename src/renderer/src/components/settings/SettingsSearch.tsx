import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
}

export function SettingsSearch({
  value,
  onChange,
  onSubmit,
  placeholder = "搜索设置...",
  className,
}: SettingsSearchProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-[var(--radius-quiet)] bg-surface-low pl-10 pr-3 text-sm text-foreground",
          "placeholder:text-muted-foreground outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
      />
    </div>
  );
}
