import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";
import { useLayoutEffect } from "react";
import { resetScrapeWorkbenchToSetup } from "../adapters/workbenchSession";

interface ParsedConflict {
  title?: string;
  source?: string;
  target?: string;
}

function parseErrorContent(error: unknown): { conflicts: ParsedConflict[]; message: string } {
  const message = (
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error ?? "")
  )
    .replace(/^Error invoking remote method '[^']+':\s*/u, "")
    .trim();

  const blocks = message
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const conflicts: ParsedConflict[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let source: string | undefined;
    let target: string | undefined;
    const titleLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("待处理：") || line.startsWith("待处理:")) {
        source = line.replace(/^待处理[：:]\s*/u, "");
      } else if (line.startsWith("冲突文件：") || line.startsWith("冲突文件:")) {
        target = line.replace(/^冲突文件[：:]\s*/u, "");
      } else {
        titleLines.push(line);
      }
    }

    if (source || target) {
      conflicts.push({
        title: titleLines.join(" · ") || undefined,
        source,
        target,
      });
    }
  }

  return { conflicts, message };
}

export function ScrapeStartErrorDialog({ error, onClose }: { error: unknown; onClose(): void }) {
  const { conflicts, message } = parseErrorContent(error);
  const isConflict = conflicts.length > 0;

  useLayoutEffect(() => {
    if (error !== null && isConflict) resetScrapeWorkbenchToSetup();
  }, [error, isConflict]);

  return (
    <Dialog open={error !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isConflict ? "目标路径存在冲突" : "刮削任务未能完成"}</DialogTitle>
          <DialogDescription>
            {isConflict ? "已安全中止，未改动任何本地文件。请解决以下冲突后重试：" : "请处理以下问题后重试："}
          </DialogDescription>
        </DialogHeader>
        <div role="alert" className="max-h-[60vh] overflow-y-auto space-y-3 pr-1 text-sm">
          {isConflict ? (
            <div className="space-y-2.5">
              {conflicts.map((conflict, index) => (
                <div key={index} className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs space-y-2">
                  {conflict.title ? (
                    <div className="flex items-center gap-2 font-medium text-foreground text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span>{conflict.title}</span>
                    </div>
                  ) : null}
                  <div className="grid gap-1.5 pl-3.5">
                    {conflict.source ? (
                      <div className="space-y-0.5">
                        <span className="text-[11px] text-muted-foreground font-medium">待处理文件</span>
                        <div className="font-mono text-xs text-foreground/90 break-all select-all bg-background/60 rounded px-2 py-1 border border-border/40">
                          {conflict.source}
                        </div>
                      </div>
                    ) : null}
                    {conflict.target ? (
                      <div className="space-y-0.5">
                        <span className="text-[11px] text-destructive font-medium">冲突目标文件</span>
                        <div className="font-mono text-xs text-destructive dark:text-red-400 break-all select-all bg-destructive/10 rounded px-2 py-1 border border-destructive/20">
                          {conflict.target}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all">
              {message}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>我知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
