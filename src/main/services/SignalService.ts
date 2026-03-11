import { EventEmitter } from "node:events";
import type { Website } from "@shared/enums";

import { IpcChannel } from "@shared/IpcChannel";
import type { FileInfo, MaintenanceItemResult, ScrapeResult } from "@shared/types";
import type { BrowserWindow } from "electron";
import { type LoggerEventPayload, loggerService } from "./LoggerService";

export interface ProgressPayload {
  value: number;
  current: number;
  total: number;
}

export interface ScrapeInfoPayload {
  fileInfo: FileInfo;
  site: Website;
  step: "search" | "parse" | "download" | "organize";
}

export interface FailedInfoPayload {
  fileInfo: FileInfo;
  error: string;
  site?: Website;
}

export interface ButtonStatusPayload {
  startEnabled: boolean;
  stopEnabled: boolean;
}

export class SignalService extends EventEmitter {
  private mainWindow: BrowserWindow | null;

  private readonly logger = loggerService.getLogger("Signal");

  constructor(mainWindow: BrowserWindow | null = null) {
    super();
    this.mainWindow = mainWindow;
  }

  setMainWindow(mainWindow: BrowserWindow | null): void {
    this.mainWindow = mainWindow;
  }

  showLogText(text: string, level: "info" | "warn" | "error" = "info"): void {
    this.logger.log(level, text);
  }

  forwardLoggerLog(payload: LoggerEventPayload): void {
    const level = payload.level === "warn" || payload.level === "error" ? payload.level : "info";
    this.send(IpcChannel.Event_Log, {
      text: payload.text,
      level,
      timestamp: payload.timestamp,
    });
  }

  setProgress(value: number, current: number, total: number): void {
    const payload: ProgressPayload = {
      value,
      current,
      total,
    };

    this.send(IpcChannel.Event_Progress, payload);
  }

  showScrapeInfo(payload: ScrapeInfoPayload): void {
    this.send(IpcChannel.Event_ScrapeInfo, payload);
  }

  showScrapeResult(payload: ScrapeResult): void {
    this.send(IpcChannel.Event_ScrapeResult, payload);
  }

  showFailedInfo(payload: FailedInfoPayload): void {
    this.send(IpcChannel.Event_FailedInfo, payload);
  }

  setButtonStatus(startEnabled: boolean, stopEnabled: boolean): void {
    const payload: ButtonStatusPayload = {
      startEnabled,
      stopEnabled,
    };

    this.send(IpcChannel.Event_ButtonStatus, payload);
  }

  showMaintenanceItemResult(payload: MaintenanceItemResult): void {
    this.send(IpcChannel.Event_MaintenanceItemResult, payload);
  }

  private send<TPayload>(channel: IpcChannel, payload: TPayload): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send(channel, payload);
    this.emit(channel, payload);
  }
}
