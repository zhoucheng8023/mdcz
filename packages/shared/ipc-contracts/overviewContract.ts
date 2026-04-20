import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";

export interface OverviewRecentAcquisitionItem {
  number: string;
  title: string | null;
  actors: string[];
  thumbnailPath: string | null;
  lastKnownPath: string | null;
  completedAt: number;
}

export interface OverviewOutputSummary {
  fileCount: number;
  totalBytes: number;
  scannedAt: number;
  rootPath: string | null;
}

export type OverviewIpcContract = {
  [IpcChannel.Overview_GetRecentAcquisitions]: IpcProcedure<void, { items: OverviewRecentAcquisitionItem[] }>;
  [IpcChannel.Overview_GetOutputSummary]: IpcProcedure<void, OverviewOutputSummary>;
};
