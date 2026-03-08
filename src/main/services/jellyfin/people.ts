import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { listFiles, pathExists } from "@main/utils/file";
import { parseNfo } from "@main/utils/nfo";
import type { ActorProfile } from "@shared/types";
import { buildJellyfinHeaders, buildJellyfinUrl, isUuid, type JellyfinMode, normalizeActorName } from "./auth";
import { JellyfinServiceError, toJellyfinServiceError } from "./errors";

interface JellyfinPersonsResponse {
  Items?: unknown;
}

type ItemDetail = Record<string, unknown>;

export interface JellyfinBatchResult {
  processedCount: number;
  failedCount: number;
}

export interface JellyfinPerson {
  Id: string;
  Name: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

export interface ActorSource {
  name: string;
  aliases: string[];
  description?: string;
  coverUrl?: string;
}

export interface JellyfinActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
}

type BiographySource = "local";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringValue = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const toStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    const normalized = toStringValue(recordValue);
    if (normalized) {
      output[key] = normalized;
    }
  }
  return output;
};

const toNumberValue = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const hasOverview = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const isRemoteUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

const mergeActorSource = (existing: ActorSource | undefined, incoming: ActorSource): ActorSource => {
  const aliasSet = new Set<string>();

  for (const alias of existing?.aliases ?? []) {
    aliasSet.add(alias);
  }
  for (const alias of incoming.aliases) {
    aliasSet.add(alias);
  }

  const nextCoverUrl = (() => {
    if (!existing?.coverUrl) {
      return incoming.coverUrl;
    }
    if (!incoming.coverUrl) {
      return existing.coverUrl;
    }
    if (isRemoteUrl(existing.coverUrl) && !isRemoteUrl(incoming.coverUrl)) {
      return incoming.coverUrl;
    }
    return existing.coverUrl;
  })();

  return {
    name: existing?.name ?? incoming.name,
    aliases: Array.from(aliasSet),
    description: existing?.description ?? incoming.description,
    coverUrl: nextCoverUrl,
  };
};

const buildActorSourceVariants = (source: ActorSource): string[] => {
  return [source.name, ...source.aliases].map((item) => item.trim()).filter((item) => item.length > 0);
};

const resolveActorCoverUrl = async (nfoPath: string, profile: ActorProfile): Promise<string | undefined> => {
  if (!profile.cover_url) {
    return undefined;
  }
  if (isRemoteUrl(profile.cover_url)) {
    return profile.cover_url;
  }

  const absolutePath = isAbsolute(profile.cover_url) ? profile.cover_url : join(dirname(nfoPath), profile.cover_url);
  return (await pathExists(absolutePath)) ? absolutePath : undefined;
};

const buildPersonUpdatePayload = (
  person: JellyfinPerson,
  detail: ItemDetail,
  overview: string,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    Id: person.Id,
    Name: toStringValue(detail.Name) ?? person.Name,
    Overview: overview,
  };

  const serverId = toStringValue(detail.ServerId);
  if (serverId) {
    payload.ServerId = serverId;
  }

  const genres = toStringArray(detail.Genres);
  if (genres.length > 0) {
    payload.Genres = genres;
  }

  const tags = toStringArray(detail.Tags);
  if (tags.length > 0) {
    payload.Tags = tags;
  }

  const providerIds = toStringRecord(detail.ProviderIds);
  if (Object.keys(providerIds).length > 0) {
    payload.ProviderIds = providerIds;
  }

  const productionLocations = toStringArray(detail.ProductionLocations);
  if (productionLocations.length > 0) {
    payload.ProductionLocations = productionLocations;
  }

  const premiereDate = toStringValue(detail.PremiereDate);
  if (premiereDate) {
    payload.PremiereDate = premiereDate;
  }

  const productionYear = toNumberValue(detail.ProductionYear);
  if (productionYear !== undefined) {
    payload.ProductionYear = productionYear;
  }

  const taglines = toStringArray(detail.Taglines);
  if (taglines.length > 0) {
    payload.Taglines = taglines;
  }

  return payload;
};

export const buildActorSourceIndex = async (configuration: Configuration): Promise<Map<string, ActorSource>> => {
  const mediaPath = configuration.paths.mediaPath.trim();
  if (!mediaPath) {
    return new Map<string, ActorSource>();
  }

  let files: string[];
  try {
    files = await listFiles(mediaPath, true);
  } catch {
    return new Map<string, ActorSource>();
  }

  const nfoFiles = files.filter((filePath) => extname(filePath).toLowerCase() === ".nfo");
  const sources = new Map<string, ActorSource>();

  for (const nfoPath of nfoFiles) {
    try {
      const xml = await readFile(nfoPath, "utf8");
      const parsed = parseNfo(xml);

      for (const profile of parsed.actor_profiles ?? []) {
        const name = profile.name.trim();
        if (!name) {
          continue;
        }

        const nextSource: ActorSource = {
          name,
          aliases: profile.aliases ?? [],
          description: profile.description,
          coverUrl: await resolveActorCoverUrl(nfoPath, profile),
        };

        const existing = sources.get(normalizeActorName(name));
        const merged = mergeActorSource(existing, nextSource);
        for (const variant of buildActorSourceVariants(merged)) {
          sources.set(normalizeActorName(variant), merged);
        }
      }
    } catch {
      // Ignore unrelated or invalid NFO files when building local actor sources.
    }
  }

  return sources;
};

export const fetchPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: {
    limit?: number;
    fields?: string[];
  } = {},
): Promise<JellyfinPerson[]> => {
  const trimmedUserId = configuration.server.userId.trim();
  if (trimmedUserId && !isUuid(trimmedUserId)) {
    throw new JellyfinServiceError("JELLYFIN_INVALID_USER_ID", "Jellyfin userId 必须为 UUID");
  }

  const url = buildJellyfinUrl(configuration, "/Persons", {
    userId: trimmedUserId || undefined,
    Limit: options.limit !== undefined ? String(options.limit) : undefined,
    Fields: options.fields?.join(","),
  });

  try {
    const response = await networkClient.getJson<JellyfinPersonsResponse>(url, {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });

    if (!Array.isArray(response.Items)) {
      return [];
    }

    return response.Items.flatMap((item): JellyfinPerson[] => {
      if (!isRecord(item)) {
        return [];
      }

      const id = toStringValue(item.Id);
      const name = toStringValue(item.Name);
      if (!id || !name) {
        return [];
      }

      return [
        {
          Id: id,
          Name: name,
          Overview: toStringValue(item.Overview),
          ImageTags: isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined,
        },
      ];
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 人物读取请求参数无效" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin API Key 无效或已失效" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物读取权限" },
      },
      {
        code: "JELLYFIN_UNREACHABLE",
        message: "读取 Jellyfin 人物列表失败",
      },
    );
  }
};

export const fetchPersonDetail = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
): Promise<ItemDetail> => {
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

  try {
    return await networkClient.getJson<ItemDetail>(url, {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        401: { code: "JELLYFIN_AUTH_FAILED", message: `读取人物详情失败：${person.Name} 的凭据无效` },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: `读取人物详情失败：没有 ${person.Name} 的访问权限` },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Jellyfin 中不存在人物 ${person.Name}` },
      },
      {
        code: "JELLYFIN_UNREACHABLE",
        message: `读取人物详情失败：${person.Name}`,
      },
    );
  }
};

export const fetchMetadataEditorInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> => {
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(personId)}/MetadataEditor`);

  try {
    return await networkClient.getJson<Record<string, unknown>>(url, {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法校验人物写权限" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物写入权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin 无法获取人物元数据编辑信息" },
      },
      {
        code: "JELLYFIN_UNREACHABLE",
        message: "读取 Jellyfin MetadataEditor 信息失败",
      },
    );
  }
};

export const refreshPerson = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(personId)}/Refresh`, {
    Recursive: "false",
    MetadataRefreshMode: "FullRefresh",
    ImageRefreshMode: "FullRefresh",
    ReplaceAllMetadata: "false",
    ReplaceAllImages: "false",
  });

  try {
    await networkClient.postText(url, "", {
      headers: buildJellyfinHeaders(configuration),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物刷新请求" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法刷新人物" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物刷新权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin 无法刷新指定人物" },
      },
      {
        code: "JELLYFIN_REFRESH_FAILED",
        message: "刷新 Jellyfin 人物失败",
      },
    );
  }
};

export const updatePersonOverview = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
  detail: ItemDetail,
  overview: string,
): Promise<void> => {
  const payload = buildPersonUpdatePayload(person, detail, overview);
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

  try {
    await networkClient.postText(url, JSON.stringify(payload), {
      headers: buildJellyfinHeaders(configuration, {
        "content-type": "application/json",
      }),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: `Jellyfin 拒绝更新人物信息：${person.Name}` },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法写入人物信息" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物写入权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Jellyfin 中不存在人物 ${person.Name}` },
      },
      {
        code: "JELLYFIN_WRITE_FAILED",
        message: `写入 Jellyfin 人物信息失败：${person.Name}`,
      },
    );
  }
};

const resolvePersonOverview = async (
  configuration: Configuration,
  _personName: string,
  source: ActorSource | undefined,
): Promise<string | undefined> => {
  for (const provider of configuration.server.personOverviewSources as BiographySource[]) {
    switch (provider) {
      case "local":
        if (source?.description) {
          return source.description;
        }
        break;
    }
  }

  return undefined;
};

export class JellyfinActorInfoService {
  private readonly logger = loggerService.getLogger("JellyfinActorInfo");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: JellyfinActorInfoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    const persons = await fetchPersons(this.networkClient, configuration, {
      fields: ["Overview"],
    });
    const sources = await buildActorSourceIndex(configuration);
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

      if (mode === "missing" && hasOverview(person.Overview)) {
        continue;
      }

      try {
        const source = sources.get(normalizeActorName(person.Name));
        const nextOverview = await resolvePersonOverview(configuration, person.Name, source);
        if (!nextOverview || nextOverview === person.Overview) {
          continue;
        }

        const detail = await fetchPersonDetail(this.networkClient, configuration, person);
        await updatePersonOverview(this.networkClient, configuration, person, detail, nextOverview);
        if (configuration.server.refreshPersonAfterSync) {
          try {
            await refreshPerson(this.networkClient, configuration, person.Id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to refresh Jellyfin actor ${person.Name} after overview sync: ${message}`);
          }
        }
        processedCount += 1;
        this.deps.signalService.showLogText(`Updated Jellyfin actor overview: ${person.Name}`);
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to update Jellyfin actor overview for ${person.Name}: ${message}`);
      }
    }

    this.deps.signalService.showLogText(
      `Jellyfin actor info sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }
}
