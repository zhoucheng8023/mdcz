import type { UncensoredConfirmResultItem } from "@shared/types";
import type { StateCreator } from "zustand";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ScrapeResult {
  id: string;
  status: "success" | "failed";
  number: string;
  title?: string;
  path: string;
  actors?: string[];
  outline?: string;
  tags?: string[];
  release?: string;
  duration?: string;
  resolution?: string;
  codec?: string;
  bitrate?: string;
  directors?: string[];
  series?: string;
  studio?: string;
  publisher?: string;
  score?: string;
  posterUrl?: string;
  thumbUrl?: string;
  fanartUrl?: string;
  outputPath?: string;
  sceneImages?: string[];
  /** Maps field names to the website that provided the value. */
  sources?: Record<string, string>;
  errorMessage?: string;
  /** True when the video is classified as uncensored but the specific type (破解/流出) is unknown. */
  uncensoredAmbiguous?: boolean;
  /** NFO path for post-scrape operations like uncensored confirmation. */
  nfoPath?: string;
}

interface ScrapeState {
  isScraping: boolean;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  progress: number;
  total: number;
  current: number;
  failedCount: number;
  results: ScrapeResult[];
  currentFilePath: string;
  statusText: string;

  setScraping: (isScraping: boolean) => void;
  setScrapeStatus: (status: "idle" | "running" | "stopping" | "paused") => void;
  updateProgress: (current: number, total: number) => void;
  addResult: (result: ScrapeResult) => void;
  clearResults: () => void;
  setCurrentFilePath: (path: string) => void;
  setStatusText: (text: string) => void;
  setFailedCount: (count: number) => void;
  resolveUncensoredResults: (updates: UncensoredConfirmResultItem[]) => void;
  reset: () => void;
}

// 开发环境下启用 HMR 状态持久化
const isDev = import.meta.env.DEV;
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

// Renderer builds without a path polyfill, so keep this dirname logic local.
const deriveOutputPathFromVideoPath = (videoPath: string): string | undefined => {
  const normalizedPath = videoPath.trim();
  if (!normalizedPath) {
    return undefined;
  }

  const slash = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  if (slash < 0) {
    return undefined;
  }

  if (slash === 0) {
    return normalizedPath[0];
  }

  return normalizedPath.slice(0, slash);
};

const shouldGroupMultipartResult = (existing: ScrapeResult, incoming: ScrapeResult): boolean => {
  return (
    existing.status === "success" &&
    incoming.status === "success" &&
    existing.number === incoming.number &&
    Boolean(existing.outputPath) &&
    existing.outputPath === incoming.outputPath
  );
};

const pickLongerArray = <T>(incoming: T[] | undefined, existing: T[] | undefined): T[] | undefined => {
  if (!incoming?.length) {
    return existing;
  }

  if (!existing?.length || incoming.length >= existing.length) {
    return incoming;
  }

  return existing;
};

const mergeGroupedMultipartResult = (existing: ScrapeResult, incoming: ScrapeResult): ScrapeResult => {
  return {
    id: existing.id,
    status: existing.status,
    number: existing.number,
    path: existing.path || incoming.path,
    title: incoming.title ?? existing.title,
    actors: incoming.actors ?? existing.actors,
    outline: incoming.outline ?? existing.outline,
    tags: incoming.tags ?? existing.tags,
    release: incoming.release ?? existing.release,
    duration: incoming.duration ?? existing.duration,
    resolution: incoming.resolution ?? existing.resolution,
    codec: incoming.codec ?? existing.codec,
    bitrate: incoming.bitrate ?? existing.bitrate,
    directors: incoming.directors ?? existing.directors,
    series: incoming.series ?? existing.series,
    studio: incoming.studio ?? existing.studio,
    publisher: incoming.publisher ?? existing.publisher,
    score: incoming.score ?? existing.score,
    posterUrl: incoming.posterUrl ?? existing.posterUrl,
    thumbUrl: incoming.thumbUrl ?? existing.thumbUrl,
    fanartUrl: incoming.fanartUrl ?? existing.fanartUrl,
    outputPath: existing.outputPath || incoming.outputPath,
    sceneImages: pickLongerArray(incoming.sceneImages, existing.sceneImages),
    sources: incoming.sources ?? existing.sources,
    errorMessage: incoming.errorMessage ?? existing.errorMessage,
    uncensoredAmbiguous: incoming.uncensoredAmbiguous ?? existing.uncensoredAmbiguous,
    nfoPath: incoming.nfoPath ?? existing.nfoPath,
  };
};

const storeCreator: StateCreator<ScrapeState> = (set) => ({
  isScraping: false,
  scrapeStatus: "idle",
  progress: 0,
  total: 0,
  current: 0,
  failedCount: 0,
  results: [],
  currentFilePath: "",
  statusText: "",

  setScraping: (isScraping) => set({ isScraping }),
  setScrapeStatus: (status) => set({ scrapeStatus: status }),
  updateProgress: (current, total) =>
    set({
      current,
      total,
      progress: total > 0 ? (current / total) * 100 : 0,
    }),
  addResult: (result) =>
    set((state) => {
      const groupedIndex = state.results.findIndex((existing) => shouldGroupMultipartResult(existing, result));
      if (groupedIndex < 0) {
        return { results: [...state.results, result] };
      }

      const nextResults = [...state.results];
      nextResults[groupedIndex] = mergeGroupedMultipartResult(nextResults[groupedIndex], result);
      return { results: nextResults };
    }),
  clearResults: () =>
    set({
      results: [],
      failedCount: 0,
      statusText: "",
      currentFilePath: "",
    }),
  setCurrentFilePath: (path) => set({ currentFilePath: path }),
  setStatusText: (text) => set({ statusText: text }),
  setFailedCount: (count) => set({ failedCount: Math.max(0, count) }),
  resolveUncensoredResults: (updates) =>
    set((state) => {
      const updateBySourcePath = new Map(updates.map((item) => [item.sourceVideoPath, item]));
      return {
        results: state.results.map((result) => {
          const matched = updateBySourcePath.get(result.path);
          if (!matched) {
            return result;
          }

          return {
            ...result,
            path: matched.targetVideoPath,
            nfoPath: matched.targetNfoPath,
            outputPath: deriveOutputPathFromVideoPath(matched.targetVideoPath),
            uncensoredAmbiguous: false,
          };
        }),
      };
    }),
  reset: () =>
    set({
      isScraping: false,
      scrapeStatus: "idle",
      progress: 0,
      total: 0,
      current: 0,
      failedCount: 0,
      results: [],
      currentFilePath: "",
      statusText: "",
    }),
});

export const useScrapeStore = isDev
  ? create<ScrapeState>()(
      persist(storeCreator, {
        name: "scrape-store",
        storage: createJSONStorage(() => (typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage)),
      }),
    )
  : create<ScrapeState>()(storeCreator);
