import type {
  PublicationConflictChoice,
  PublicationConflictResolution,
  PublicationConflictSnapshot,
} from "@mdcz/shared/publicationConflicts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@mdcz/ui";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

export function PublicationConflictDialog({
  list,
  resolve,
}: {
  list(): Promise<PublicationConflictSnapshot[]>;
  resolve(input: PublicationConflictResolution): Promise<unknown>;
}) {
  const [conflicts, setConflicts] = useState<PublicationConflictSnapshot[]>([]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await list();
        if (!cancelled) setConflicts(next);
      } catch {
        // Poll errors are ignored during background status checks
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [list]);

  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflict = conflicts[0];

  const choose = async (choice: PublicationConflictChoice) => {
    if (!conflict) return;
    setBusy(true);
    setError(null);
    try {
      await resolve({ id: conflict.id, choice });
      setConflicts(await list());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!conflict) return null;

  const isDismissed = dismissed === conflict.id;

  return (
    <>
      {isDismissed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-quiet-capsule px-2.5 text-xs font-bold text-amber-500 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
          onClick={() => setDismissed(null)}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          待处理冲突 ({conflicts.length})
        </Button>
      ) : null}

      <Dialog
        open={!isDismissed}
        onOpenChange={(open) => {
          if (!open) setDismissed(conflict.id);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>目标位置已有同名文件</DialogTitle>
            <DialogDescription>此项目等待选择，其他项目继续处理。关闭窗口不会删除文件。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 break-all text-sm">
            <p>
              新文件：{conflict.sourcePath ?? "本次生成的资源"}
              <br />
              {conflict.sourceSize} 字节
              {conflict.sourceModifiedAt !== null ? ` · ${new Date(conflict.sourceModifiedAt).toLocaleString()}` : ""}
            </p>
            <p>
              现有文件：{conflict.targetPath}
              <br />
              {conflict.targetSize} 字节 · {new Date(conflict.targetModifiedAt).toLocaleString()}
            </p>
            <p>保留两份时，新文件保存为：{conflict.keepBothPath}</p>
            <p>对应字幕和 STRM 将跟随所选视频，共享 NFO、图片和花絮保持番号级文件名。</p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button disabled={busy} onClick={() => void choose("keep_both")}>
              保留两份
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void choose("keep_new")}>
              保留新文件，清除现有文件
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void choose("keep_existing")}>
              保留现有文件，清除新文件
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
