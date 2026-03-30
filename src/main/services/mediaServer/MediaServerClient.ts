import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import type { MediaServerErrorMapping, MediaServerServiceError } from "./MediaServerError";

export type MediaServerKey = "jellyfin" | "emby";
export type MediaServerMode = "all" | "missing";
export type MediaServerHeadersInit = Headers | Record<string, string> | Array<[string, string]>;
export type MediaServerItemDetail = Record<string, unknown>;

export interface MediaServerPersonBase {
  Id: string;
  Name: string;
}

const getMediaServerConfig = (configuration: Configuration, serverKey: MediaServerKey) => {
  return serverKey === "jellyfin" ? configuration.jellyfin : configuration.emby;
};

export const normalizeMediaServerBaseUrl = (value: string): string => {
  return value.trim().replace(/\/+$/u, "");
};

export const parseMediaServerMode = (value: unknown): MediaServerMode | null => {
  if (value === "all" || value === "missing") {
    return value;
  }
  return null;
};

export const buildMediaServerUrl = (
  configuration: Configuration,
  serverKey: MediaServerKey,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  const baseUrl = normalizeMediaServerBaseUrl(getMediaServerConfig(configuration, serverKey).url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  const apiKey = getMediaServerConfig(configuration, serverKey).apiKey.trim();

  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
  }

  for (const [key, value] of Object.entries(query)) {
    if (!value || value.trim().length === 0) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  return url.toString();
};

export const buildMediaServerHeaders = (
  configuration: Configuration,
  serverKey: MediaServerKey,
  headers: MediaServerHeadersInit = {},
): Headers => {
  const next = new Headers(headers);
  const apiKey = getMediaServerConfig(configuration, serverKey).apiKey.trim();
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

export const normalizeMediaServerPersons = <TPerson extends MediaServerPersonBase>(
  persons: ReadonlyArray<TPerson>,
): TPerson[] => {
  const uniquePersons = new Map<string, TPerson>();

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

interface MediaServerRequestOptions<TError extends MediaServerServiceError> {
  networkClient: NetworkClient;
  configuration: Configuration;
  serverKey: MediaServerKey;
  personId: string;
  toServiceError: (
    error: unknown,
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
    fallback: MediaServerErrorMapping,
  ) => TError;
}

interface FetchMediaServerPersonsOptions<TPerson, TError extends MediaServerServiceError>
  extends Omit<MediaServerRequestOptions<TError>, "personId"> {
  path?: string;
  query?: Record<string, string | undefined>;
  extractItems: (response: unknown) => unknown[];
  parsePerson: (item: unknown) => TPerson | null;
  normalizePersons?: (persons: TPerson[]) => TPerson[];
}

export const fetchMediaServerPersons = async <TPerson, TError extends MediaServerServiceError>(
  options: FetchMediaServerPersonsOptions<TPerson, TError>,
  errorMappings: {
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>;
    fallback: MediaServerErrorMapping;
  },
): Promise<TPerson[]> => {
  const url = buildMediaServerUrl(options.configuration, options.serverKey, options.path ?? "/Persons", options.query);

  try {
    const response = await options.networkClient.getJson<unknown>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });

    const persons = options.extractItems(response).flatMap((item): TPerson[] => {
      const parsed = options.parsePerson(item);
      return parsed ? [parsed] : [];
    });

    return options.normalizePersons ? options.normalizePersons(persons) : persons;
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const fetchMediaServerItemDetail = async <
  TDetail extends MediaServerItemDetail,
  TError extends MediaServerServiceError,
>(
  options: Omit<MediaServerRequestOptions<TError>, "personId"> & {
    path: string;
  },
  errorMappings: {
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>;
    fallback: MediaServerErrorMapping;
  },
): Promise<TDetail> => {
  const url = buildMediaServerUrl(options.configuration, options.serverKey, options.path);

  try {
    return await options.networkClient.getJson<TDetail>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const fetchMediaServerMetadataEditorInfo = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError>,
  errorMappings: {
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>;
    fallback: MediaServerErrorMapping;
  },
): Promise<Record<string, unknown>> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}/MetadataEditor`,
  );

  try {
    return await options.networkClient.getJson<Record<string, unknown>>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const refreshMediaServerPerson = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError>,
  errorMappings: {
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>;
    fallback: MediaServerErrorMapping;
  },
): Promise<void> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}/Refresh`,
    {
      Recursive: "false",
      MetadataRefreshMode: "FullRefresh",
      ImageRefreshMode: "FullRefresh",
      ReplaceAllMetadata: "false",
      ReplaceAllImages: "false",
    },
  );

  try {
    await options.networkClient.postText(url, "", {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey),
    });
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const updateMediaServerItem = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError> & {
    payload: Record<string, unknown>;
  },
  errorMappings: {
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>;
    fallback: MediaServerErrorMapping;
  },
): Promise<void> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}`,
  );

  try {
    await options.networkClient.postText(url, JSON.stringify(options.payload), {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        "content-type": "application/json",
      }),
    });
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};
