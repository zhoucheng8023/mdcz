import { PauseCircle, Play, RotateCcw, StopCircle } from "lucide-react";
import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { FloatingWorkbenchBar } from "@/components/shared/FloatingWorkbenchBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { cn } from "@/lib/utils";
import { useScrapeStore } from "@/store/scrapeStore";

export interface ScrapeWorkbenchProps {
  mediaPath: string;
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  failedCount: number;
}

export default function ScrapeWorkbench({
  mediaPath,
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  failedCount,
}: ScrapeWorkbenchProps) {
  const { isScraping, scrapeStatus, progress, currentFilePath, statusText } = useScrapeStore();
  const showControls = isScraping || failedCount > 0;

  return (
    <div className="relative h-full overflow-hidden bg-surface-canvas">
      <div className="flex h-full min-h-0 p-4 md:p-6 lg:p-8">
        <ResizablePanelGroup orientation="horizontal" className="flex-1 gap-3">
          <ResizablePanel
            id="result-list"
            defaultSize={34}
            minSize={22}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-low/80"
          >
            <ResultTree />
          </ResizablePanel>

          <ResizableHandle className="w-1 rounded-full bg-transparent transition-colors hover:bg-foreground/10" />

          <ResizablePanel
            id="detail-view"
            defaultSize={66}
            minSize={32}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-floating/94"
          >
            <DetailPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {showControls && (
        <FloatingWorkbenchBar contentClassName="mx-auto flex w-full max-w-3xl items-center gap-4 px-4 py-3 md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {isScraping && (
              <div className="flex min-w-48 items-center gap-3">
                <Progress value={progress} className="h-1.5 w-24 md:w-28" />
                <span className="w-10 font-numeric text-[11px] font-bold text-foreground">{Math.round(progress)}%</span>
              </div>
            )}

            <div className="min-w-0 max-w-lg text-xs text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground/80">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isScraping ? "animate-pulse bg-foreground" : "bg-muted-foreground/40",
                  )}
                />
                <span className="font-medium">{isScraping ? "正在处理" : "就绪"}</span>
                {statusText && <span>{statusText}</span>}
              </div>
              {isScraping && currentFilePath && <div className="mt-1 truncate font-mono">{currentFilePath}</div>}
              {!isScraping && mediaPath && <div className="mt-1 truncate font-mono">{mediaPath}</div>}
            </div>
          </div>

          {isScraping && (
            <>
              <Button
                type="button"
                variant="ghost"
                className="rounded-quiet-capsule"
                onClick={scrapeStatus === "paused" ? onResumeScrape : onPauseScrape}
              >
                {scrapeStatus === "paused" ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                {scrapeStatus === "paused" ? "恢复" : "暂停"}
              </Button>
              <Button type="button" variant="destructive" className="rounded-quiet-capsule" onClick={onStopScrape}>
                <StopCircle className="h-4 w-4" />
                停止
              </Button>
            </>
          )}

          {!isScraping && failedCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="rounded-quiet-capsule text-destructive hover:text-destructive"
              onClick={onRetryFailed}
            >
              <RotateCcw className="h-4 w-4" />
              重试失败
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                {failedCount}
              </Badge>
            </Button>
          )}
        </FloatingWorkbenchBar>
      )}
    </div>
  );
}
