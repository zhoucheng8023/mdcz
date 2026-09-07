import {
  selectIsScraping,
  selectScrapeProgress,
  selectScrapeResults,
  selectScrapeStatus,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { ScrapeWorkbenchFrame } from "../workbench";
import { DetailPanelAdapter } from "./DetailPanelAdapter";
import type { SharedWorkbenchPorts } from "./ports";
import { ResultTreeAdapter } from "./ResultTreeAdapter";
import { resetScrapeWorkbenchToSetup } from "./workbenchSession";

export interface ScrapeWorkbenchAdapterProps {
  ports: Pick<SharedWorkbenchPorts, "detail" | "scrape">;
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  failedCount: number;
  conflictAction?: ReactNode;
}

export function ScrapeWorkbenchAdapter({
  ports,
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  failedCount,
  conflictAction,
}: ScrapeWorkbenchAdapterProps) {
  const { isScraping, scrapeStatus, progress, resultsCount } = useScrapeStore(
    useShallow((state) => ({
      isScraping: selectIsScraping(state),
      scrapeStatus: selectScrapeStatus(state),
      progress: selectScrapeProgress(state),
      resultsCount: selectScrapeResults(state).length,
    })),
  );

  return (
    <ScrapeWorkbenchFrame
      list={<ResultTreeAdapter port={ports.scrape} />}
      detail={<DetailPanelAdapter port={ports.detail} />}
      isScraping={isScraping}
      scrapeStatus={scrapeStatus}
      progress={progress}
      showCompletedActions={!isScraping && resultsCount > 0}
      failedCount={failedCount}
      conflictAction={conflictAction}
      onPauseScrape={onPauseScrape}
      onResumeScrape={onResumeScrape}
      onStopScrape={onStopScrape}
      onRetryFailed={onRetryFailed}
      onReturnToSetup={resetScrapeWorkbenchToSetup}
    />
  );
}
