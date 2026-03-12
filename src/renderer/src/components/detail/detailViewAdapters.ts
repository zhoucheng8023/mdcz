import type { LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem } from "@shared/types";
import type { DetailViewItem } from "@/components/detail/types";
import type { ScrapeResult } from "@/store/scrapeStore";

const formatDuration = (durationSeconds: number | undefined): string | undefined => {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const getMaintenanceDetailTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

export const toDetailViewItemFromScrapeResult = (result: ScrapeResult): DetailViewItem => ({
  id: result.id,
  status: result.status,
  number: result.number,
  title: result.title,
  path: result.path,
  actors: result.actors,
  outline: result.outline,
  tags: result.tags,
  release: result.release,
  duration: result.duration,
  resolution: result.resolution,
  codec: result.codec,
  bitrate: result.bitrate,
  directors: result.directors,
  series: result.series,
  studio: result.studio,
  publisher: result.publisher,
  score: result.score,
  posterUrl: result.poster_url,
  thumbUrl: result.thumb_url,
  fanartUrl: result.fanart_url,
  outputPath: result.output_path,
  sceneImages: result.scene_images,
  errorMessage: result.error_msg,
});

export const toDetailViewItemFromMaintenanceEntry = (
  entry: LocalScanEntry,
  result?: MaintenanceItemResult | MaintenancePreviewItem,
): DetailViewItem => {
  const data = entry.crawlerData;
  const hasEntryError = Boolean(entry.scanError);

  return {
    id: entry.id,
    status: result?.status === "failed" || result?.status === "blocked" || hasEntryError ? "failed" : "success",
    number: entry.fileInfo.number,
    path: entry.videoPath,
    nfoPath: entry.nfoPath,
    title: getMaintenanceDetailTitle(entry),
    actors: data?.actors,
    outline: data?.plot_zh ?? data?.plot,
    tags: data?.genres,
    release: data?.release_date,
    duration: formatDuration(data?.durationSeconds),
    resolution: entry.fileInfo.resolution,
    directors: data?.director ? [data.director] : undefined,
    series: data?.series,
    studio: data?.studio,
    publisher: data?.publisher,
    score: typeof data?.rating === "number" ? String(data.rating) : undefined,
    posterUrl: entry.assets.poster ?? data?.poster_url,
    thumbUrl: entry.assets.thumb ?? entry.assets.fanart ?? data?.thumb_url ?? data?.fanart_url,
    fanartUrl: entry.assets.fanart ?? entry.assets.thumb ?? data?.fanart_url ?? data?.thumb_url,
    outputPath: entry.currentDir,
    sceneImages: entry.assets.sceneImages.length > 0 ? entry.assets.sceneImages : data?.sample_images,
    errorMessage: result?.error ?? entry.scanError,
  };
};
