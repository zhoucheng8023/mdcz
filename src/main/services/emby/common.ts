import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { isRecord, isString, toErrorMessage } from "@main/utils/common";
import type { PersonSyncResult } from "@shared/ipcTypes";

export type EmbyMode = "all" | "missing";

export type EmbyBatchResult = PersonSyncResult;

export interface EmbyPerson {
  Id: string;
  Name: string;
  ServerId?: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

interface EmbyListResponse {
  Items?: unknown;
}

interface EmbyUserResponse {
  Id?: unknown;
  Policy?: unknown;
}

export type ItemDetail = Record<string, unknown>;

export class EmbyServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const normalizeBaseUrl = (value: string): string => {
  return value.trim().replace(/\/+$/u, "");
};

export const parseMode = (value: unknown): EmbyMode | null => {
  if (value === "all" || value === "missing") {
    return value;
  }
  return null;
};

export const getHttpStatus = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const matched = error.message.match(/HTTP\s+(\d{3})\b/u);
  if (!matched) {
    return undefined;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const toEmbyServiceError = (
  error: unknown,
  statusMappings: Partial<Record<number, { code: string; message: string }>>,
  fallback: { code: string; message: string },
): EmbyServiceError => {
  if (error instanceof EmbyServiceError) {
    return error;
  }

  const status = getHttpStatus(error);
  const mapped = status !== undefined ? statusMappings[status] : undefined;
  if (mapped) {
    return new EmbyServiceError(mapped.code, mapped.message, status);
  }

  return new EmbyServiceError(fallback.code, `${fallback.message}: ${toErrorMessage(error)}`, status);
};

export const hasPrimaryImage = (person: EmbyPerson): boolean => {
  const primary = person.ImageTags?.Primary;
  return typeof primary === "string" && primary.trim().length > 0;
};

export const toStringValue = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

export const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

export const toStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    if (!isString(recordValue) || recordValue.trim().length === 0) {
      continue;
    }
    output[key] = recordValue.trim();
  }

  return output;
};

const ACTOR_PERSON_TYPES = ["Actor", "GuestStar"] as const;

const normalizePersons = (persons: EmbyPerson[]): EmbyPerson[] => {
  const uniquePersons = new Map<string, EmbyPerson>();

  for (const person of persons) {
    const normalizedName = person.Name.trim();
    if (!normalizedName) {
      continue;
    }

    uniquePersons.set(person.Id, {
      ...person,
      Name: normalizedName,
    });
  }

  return Array.from(uniquePersons.values());
};

const toBooleanValue = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const pickEmbyUserId = (users: EmbyUserResponse[]): string | undefined => {
  let bestId: string | undefined;
  let bestScore = -1;

  for (const user of users) {
    const id = toStringValue(user.Id);
    if (!id) {
      continue;
    }

    const policy = isRecord(user.Policy) ? user.Policy : undefined;
    const isAdministrator = toBooleanValue(policy?.IsAdministrator) ?? false;
    const enableAllFolders = toBooleanValue(policy?.EnableAllFolders) ?? false;
    const score = isAdministrator && enableAllFolders ? 3 : isAdministrator ? 2 : enableAllFolders ? 1 : 0;

    if (score > bestScore) {
      bestScore = score;
      bestId = id;
      if (score === 3) {
        break;
      }
    }
  }

  return bestId;
};

const fetchAutoResolvedEmbyUserId = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<string> => {
  const url = buildEmbyUrl(configuration, "/Users/Query");

  try {
    const response = await networkClient.getJson<EmbyListResponse>(url, {
      headers: buildEmbyHeaders(configuration, {
        accept: "application/json",
      }),
    });

    const users = Array.isArray(response.Items) ? (response.Items as EmbyUserResponse[]) : [];
    const userId = pickEmbyUserId(users);
    if (!userId) {
      throw new EmbyServiceError(
        "EMBY_USER_CONTEXT_REQUIRED",
        "当前 Emby 服务器要求用户上下文，请在设置中填写 Emby 用户 ID 后重试",
      );
    }

    return userId;
  } catch (error) {
    if (error instanceof EmbyServiceError) {
      throw error;
    }

    throw toEmbyServiceError(
      error,
      {
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效，无法读取用户列表" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有读取用户列表的权限" },
      },
      {
        code: "EMBY_USER_CONTEXT_REQUIRED",
        message: "当前 Emby 服务器要求用户上下文，请在设置中填写 Emby 用户 ID 后重试",
      },
    );
  }
};

export const resolveEmbyUserId = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  overrideUserId?: string,
): Promise<string> => {
  // This fallback is intentional: newer Emby person APIs can require a user context, so when the
  // setting is blank we pick a best-effort admin/all-folders user. Deployments that need a
  // specific library view should set `emby.userId` explicitly instead of relying on auto-resolution.
  const resolvedUserId = overrideUserId?.trim() || configuration.emby.userId.trim();
  return resolvedUserId || (await fetchAutoResolvedEmbyUserId(networkClient, configuration));
};

type EmbyHeadersInit = Headers | Record<string, string> | Array<[string, string]>;

type FetchPersonsOptions = {
  limit?: number;
  fields?: string[];
  userId?: string;
  personTypes?: string[];
};

export const buildEmbyUrl = (
  configuration: Configuration,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  const baseUrl = normalizeBaseUrl(configuration.emby.url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (configuration.emby.apiKey.trim()) {
    url.searchParams.set("api_key", configuration.emby.apiKey.trim());
  }

  for (const [key, value] of Object.entries(query)) {
    if (!value || value.trim().length === 0) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  return url.toString();
};

export const buildEmbyHeaders = (configuration: Configuration, headers: EmbyHeadersInit = {}): Headers => {
  const next = new Headers(headers);
  const apiKey = configuration.emby.apiKey.trim();
  if (!apiKey) {
    return next;
  }

  next.set("x-emby-token", apiKey);
  next.set(
    "x-emby-authorization",
    `MediaBrowser Client="MDCz", Device="MDCz", DeviceId="mdcz-tool", Version="0.1.3", Token="${apiKey}"`,
  );

  return next;
};

export const fetchPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: FetchPersonsOptions = {},
): Promise<EmbyPerson[]> => {
  const userId = options.userId?.trim() || configuration.emby.userId.trim() || undefined;
  const url = buildEmbyUrl(configuration, "/Persons", {
    userid: userId,
    Limit: options.limit !== undefined ? String(options.limit) : undefined,
    Fields: options.fields?.join(","),
    PersonTypes: options.personTypes?.join(","),
  });

  try {
    const response = await networkClient.getJson<EmbyListResponse>(url, {
      headers: buildEmbyHeaders(configuration, {
        accept: "application/json",
      }),
    });

    if (!Array.isArray(response.Items)) {
      return [];
    }

    return normalizePersons(
      response.Items.flatMap((item): EmbyPerson[] => {
        if (!isRecord(item)) {
          return [];
        }

        const id = item.Id;
        const name = item.Name;
        if (!isString(id) || !isString(name)) {
          return [];
        }

        const imageTags = isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined;

        return [
          {
            Id: id,
            Name: name,
            ServerId: isString(item.ServerId) ? item.ServerId : undefined,
            Overview: toStringValue(item.Overview),
            ImageTags: imageTags,
          },
        ];
      }),
    );
  } catch (error) {
    throw toEmbyServiceError(
      error,
      {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 人物读取请求参数无效" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效或已失效" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物读取权限" },
      },
      {
        code: "EMBY_UNREACHABLE",
        message: "读取 Emby 人物列表失败",
      },
    );
  }
};

export const fetchActorPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: Omit<FetchPersonsOptions, "personTypes"> = {},
): Promise<EmbyPerson[]> => {
  const userId = await resolveEmbyUserId(networkClient, configuration, options.userId);
  return await fetchPersons(networkClient, configuration, {
    ...options,
    userId,
    personTypes: [...ACTOR_PERSON_TYPES],
  });
};

export const fetchPersonDetail = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: EmbyPerson,
  userId: string,
): Promise<ItemDetail> => {
  const resolvedUserId = userId.trim();
  if (!resolvedUserId) {
    throw new EmbyServiceError(
      "EMBY_USER_CONTEXT_REQUIRED",
      "当前 Emby 服务器要求用户上下文，请先解析并传入 Emby 用户 ID 后重试",
    );
  }

  const url = buildEmbyUrl(
    configuration,
    `/Users/${encodeURIComponent(resolvedUserId)}/Items/${encodeURIComponent(person.Id)}`,
  );

  try {
    return await networkClient.getJson<ItemDetail>(url, {
      headers: buildEmbyHeaders(configuration, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw toEmbyServiceError(
      error,
      {
        401: { code: "EMBY_AUTH_FAILED", message: `读取人物详情失败：Emby API Key 无效，无法访问 ${person.Name}` },
        403: { code: "EMBY_PERMISSION_DENIED", message: `读取人物详情失败：当前 Emby API Key 无权访问 ${person.Name}` },
        404: { code: "EMBY_NOT_FOUND", message: `Emby 中不存在人物 ${person.Name}` },
      },
      {
        code: "EMBY_UNREACHABLE",
        message: `读取 Emby 人物详情失败：${person.Name}`,
      },
    );
  }
};

export const fetchMetadataEditorInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> => {
  const url = buildEmbyUrl(configuration, `/Items/${encodeURIComponent(personId)}/MetadataEditor`);

  try {
    return await networkClient.getJson<Record<string, unknown>>(url, {
      headers: buildEmbyHeaders(configuration, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw toEmbyServiceError(
      error,
      {
        401: { code: "EMBY_AUTH_FAILED", message: "Emby 凭据无效，无法校验人物写权限" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物写入权限" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby 无法获取人物元数据编辑页信息" },
      },
      {
        code: "EMBY_UNREACHABLE",
        message: "读取 Emby 人物元数据编辑页信息失败",
      },
    );
  }
};

export const refreshPerson = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  const url = buildEmbyUrl(configuration, `/Items/${encodeURIComponent(personId)}/Refresh`, {
    Recursive: "false",
    MetadataRefreshMode: "FullRefresh",
    ImageRefreshMode: "FullRefresh",
    ReplaceAllMetadata: "false",
    ReplaceAllImages: "false",
  });

  try {
    await networkClient.postText(url, "", {
      headers: buildEmbyHeaders(configuration),
    });
  } catch (error) {
    throw toEmbyServiceError(
      error,
      {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 拒绝了人物刷新请求" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby 凭据无效，无法刷新人物" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物刷新权限" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby 无法刷新指定人物" },
      },
      {
        code: "EMBY_REFRESH_FAILED",
        message: "刷新 Emby 人物失败",
      },
    );
  }
};
