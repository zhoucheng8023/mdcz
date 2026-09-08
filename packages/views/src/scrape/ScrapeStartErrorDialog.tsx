import { toErrorMessage } from "@mdcz/shared/error";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";

export function ScrapeStartErrorDialog({ error, onClose }: { error: unknown; onClose(): void }) {
  const message = error instanceof Error ? error.message : toErrorMessage(error);
  return (
    <Dialog open={error !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>无法启动本次任务</DialogTitle>
          <DialogDescription>请处理以下问题后重新开始。</DialogDescription>
        </DialogHeader>
        <div role="alert" className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-all text-sm">
          {message
            .split("\n")
            .map((line) => toErrorMessage(line))
            .join("\n")}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>返回检查</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
