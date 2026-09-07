import type {
  PublicationConflictChoice,
  PublicationConflictResolution,
  PublicationConflictSnapshot,
} from "@mdcz/shared/publicationConflicts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@mdcz/ui";
import { useEffect, useState } from "react";

export function PublicationConflictDialog({
  list,
  resolve,
}: {
  list(): Promise<PublicationConflictSnapshot[]>;
  resolve(input: PublicationConflictResolution): Promise<unknown>;
}) {
  const [conflicts, setConflicts] = useState<PublicationConflictSnapshot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await list();
        if (!cancelled) {
          setConflicts(next);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
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
  if (!conflict) return loadError ? <p role="alert">无法读取文件冲突：{loadError}</p> : null;
  return (
    <>
      <Button variant="outline" onClick={() => setDismissed(null)}>
        处理文件冲突（{conflicts.length}）
      </Button>
      <Dialog
        open={dismissed !== conflict.id}
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
            <p>视频加后缀时，字幕和元数据仍使用原定名称；它们的冲突分别处理。</p>
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
