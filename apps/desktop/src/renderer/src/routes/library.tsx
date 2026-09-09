import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import type { LibraryAvailabilityFilter, LibraryDeleteMode } from "@mdcz/views/library";
import {
  chunkLibraryEntryIds,
  LibraryDeleteDialog,
  LibraryIndexView,
  mergeLibraryAvailability,
} from "@mdcz/views/library";
import { useInfiniteQuery, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { getImageSrc } from "@/utils/image";

export function LibraryPage() {
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<LibraryAvailabilityFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntryDto | null>(null);
  const [deleteMode, setDeleteMode] = useState<LibraryDeleteMode>("none");
  const queryClient = useQueryClient();
  const libraryQ = useInfiniteQuery({
    queryKey: ["library", "list", query],
    queryFn: ({ pageParam }) => ipc.library.list({ cursor: pageParam, query, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const deleteLibraryM = useMutation({
    mutationFn: async ({ entry, mode }: { entry: LibraryEntryDto; mode: LibraryDeleteMode }) => {
      await ipc.library.delete({ deleteMode: mode, id: entry.id });
    },
    onSuccess: async () => {
      toast.success("已从媒体库移除");
      setDeleteTarget(null);
      setDeleteMode("none");
      await libraryQ.refetch();
      await queryClient.invalidateQueries({ queryKey: ["library", "availability"] });
    },
    onError: (error) => {
      toast.error(toErrorMessage(error));
    },
  });
  const pageEntries = libraryQ.data?.pages.flatMap((page) => page.entries) ?? [];
  const availabilityQs = useQueries({
    queries: (libraryQ.data?.pages ?? []).flatMap((page) =>
      chunkLibraryEntryIds(page.entries.map((entry) => entry.id)).map((ids) => ({
        queryKey: ["library", "availability", ids],
        queryFn: async () => await ipc.library.availability(ids),
        retry: false,
        staleTime: 30_000,
      })),
    ),
  });
  const entries = mergeLibraryAvailability(
    pageEntries,
    availabilityQs.flatMap((availabilityQ) => availabilityQ.data ?? []),
  );

  return (
    <>
      <LibraryIndexView
        availabilityFilter={availabilityFilter}
        entries={entries}
        errorMessage={libraryQ.error ? toErrorMessage(libraryQ.error) : null}
        getImageSrc={(path, entry) => getImageSrc(path, entry.thumbnailRootId ?? entry.rootId)}
        hasMore={libraryQ.hasNextPage}
        isAvailabilityLoading={availabilityQs.some((availabilityQ) => availabilityQ.isLoading)}
        isLoading={libraryQ.isLoading}
        isLoadingMore={libraryQ.isFetchingNextPage}
        onAvailabilityFilterChange={setAvailabilityFilter}
        onDeleteEntry={setDeleteTarget}
        onLoadMore={() => {
          void libraryQ.fetchNextPage();
        }}
        onOpenFolder={(entry) => {
          const path = entry.lastKnownPath;
          if (!path) {
            toast.error("无已知路径");
            return;
          }
          void ipc.app.showItemInFolder(path).catch((error: unknown) => {
            toast.error(toErrorMessage(error));
          });
        }}
        onQueryChange={setQuery}
        onRefresh={() => {
          void libraryQ.refetch();
          void queryClient.invalidateQueries({ queryKey: ["library", "availability"] });
        }}
        query={query}
        total={libraryQ.data?.pages[0]?.total ?? 0}
      />
      <LibraryDeleteDialog
        open={Boolean(deleteTarget)}
        deleteMode={deleteMode}
        showFileDeleteModes
        submitting={deleteLibraryM.isPending}
        onDeleteModeChange={setDeleteMode}
        onCancel={() => {
          if (deleteLibraryM.isPending) return;
          setDeleteTarget(null);
          setDeleteMode("none");
        }}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target || deleteLibraryM.isPending) return;
          deleteLibraryM.mutate({ entry: target, mode: deleteMode });
        }}
      />
    </>
  );
}

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});
