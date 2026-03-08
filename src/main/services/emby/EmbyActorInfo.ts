import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";

import {
  buildApiUrl,
  type EmbyBatchResult,
  type EmbyMode,
  type EmbyPerson,
  EmbyServiceError,
  fetchPersons,
  hasOverview,
  toStringArray,
  toStringRecord,
} from "./common";

type ItemDetail = Record<string, unknown>;

export interface EmbyActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
}

const toStringValue = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const toNumberValue = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export class EmbyActorInfo {
  private readonly logger = loggerService.getLogger("EmbyActorInfo");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: EmbyActorInfoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    const persons = await fetchPersons(this.networkClient, configuration);
    const total = persons.length;

    if (total === 0) {
      return {
        processedCount: 0,
        failedCount: 0,
      };
    }

    let processedCount = 0;
    let failedCount = 0;
    let current = 0;

    for (const person of persons) {
      current += 1;
      this.deps.signalService.setProgress(Math.round((current / total) * 100), current, total);

      try {
        const detail = await this.fetchDetail(configuration, person);
        const overview = toStringValue(detail.Overview);

        if (mode === "missing" && overview) {
          continue;
        }

        const nextOverview = overview ?? `${person.Name} - metadata updated by MDCz Emby tool.`;

        const payload = this.buildUpdatePayload(person, detail, nextOverview);
        const updateUrl = buildApiUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

        await this.networkClient.postText(updateUrl, JSON.stringify(payload), {
          headers: {
            "content-type": "application/json",
          },
        });

        processedCount += 1;
        this.deps.signalService.showLogText(`Updated actor profile: ${person.Name}`);
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to update actor profile for ${person.Name}: ${message}`);
      }
    }

    this.deps.signalService.showLogText(
      `Actor info sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }

  private async fetchDetail(configuration: Configuration, person: EmbyPerson): Promise<ItemDetail> {
    const detailUrl = buildApiUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

    try {
      const detail = await this.networkClient.getJson<ItemDetail>(detailUrl, {
        headers: {
          accept: "application/json",
        },
      });

      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EmbyServiceError("EMBY_UNREACHABLE", `Failed to fetch actor detail for ${person.Name}: ${message}`);
    }
  }

  private buildUpdatePayload(person: EmbyPerson, detail: ItemDetail, overview: string): Record<string, unknown> {
    const premiereDate = toStringValue(detail.PremiereDate) ?? "0000-00-00";
    const productionYear = toNumberValue(detail.ProductionYear) ?? 0;

    const taglines = toStringArray(detail.Taglines);
    if (!hasOverview(overview) && taglines.length === 0) {
      taglines.push("MDCz actor profile");
    }

    return {
      Name: toStringValue(detail.Name) ?? person.Name,
      ServerId: toStringValue(detail.ServerId) ?? person.ServerId ?? "",
      Id: person.Id,
      Genres: toStringArray(detail.Genres),
      Tags: toStringArray(detail.Tags),
      ProviderIds: toStringRecord(detail.ProviderIds),
      ProductionLocations: toStringArray(detail.ProductionLocations),
      PremiereDate: premiereDate,
      ProductionYear: productionYear,
      Overview: overview,
      Taglines: taglines,
    };
  }
}
