import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { buildJellyfinHeaders, buildJellyfinUrl, type JellyfinMode, normalizeActorName } from "./auth";
import { getHttpStatus, toJellyfinServiceError } from "./errors";
import {
  buildActorSourceIndex,
  fetchPersons,
  type JellyfinBatchResult,
  type JellyfinPerson,
  refreshPerson,
} from "./people";

interface GfriendsResponse {
  Content?: Record<string, Record<string, string>>;
}

export interface JellyfinActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorMapUrl?: string;
}

const DEFAULT_GFRIENDS_FILETREE_URL = "https://raw.githubusercontent.com/gfriends/gfriends/master/Filetree.json";

const hasFile = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const contentTypeFromPath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
};

const hasPrimaryImage = (person: JellyfinPerson): boolean => {
  const primary = person.ImageTags?.Primary;
  return typeof primary === "string" && primary.trim().length > 0;
};

const resolveRemoteActorPhotoUrl = (remoteActorMap: Map<string, string>, actorNames: string[]): string | undefined => {
  for (const actorName of actorNames) {
    const direct = remoteActorMap.get(actorName);
    if (direct) {
      return direct;
    }

    const collapsed = remoteActorMap.get(actorName.replaceAll(" ", ""));
    if (collapsed) {
      return collapsed;
    }
  }

  return undefined;
};

const resolveLocalPhotoPath = async (configuration: Configuration, actorNames: string[]): Promise<string | null> => {
  const photoFolder = configuration.server.actorPhotoFolder.trim();
  if (!photoFolder) {
    return null;
  }

  const baseNames = Array.from(new Set(actorNames.map((item) => item.trim()).filter((item) => item.length > 0)));
  const candidates = baseNames.flatMap((actorName) => [
    `${actorName}.jpg`,
    `${actorName}.jpeg`,
    `${actorName}.png`,
    `${actorName}.webp`,
    `${actorName.replaceAll(" ", "")}.jpg`,
    `${actorName.replaceAll(" ", "")}.jpeg`,
    `${actorName.replaceAll(" ", "")}.png`,
    `${actorName.replaceAll(" ", "")}.webp`,
  ]);

  for (const fileName of candidates) {
    const filePath = join(photoFolder, fileName);
    if (await hasFile(filePath)) {
      return filePath;
    }
  }

  return null;
};

const uploadPrimaryImage = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  const headers = buildJellyfinHeaders(configuration, {
    "content-type": contentType,
  });

  const primaryPath = `/Items/${encodeURIComponent(personId)}/Images/Primary`;
  try {
    await networkClient.postContent(buildJellyfinUrl(configuration, primaryPath), bytes, { headers });
    return;
  } catch (error) {
    const status = getHttpStatus(error);
    if (status !== 404 && status !== 405) {
      throw toJellyfinServiceError(
        error,
        {
          400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物头像上传请求" },
          401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法上传人物头像" },
          403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物头像写入权限" },
          415: { code: "JELLYFIN_UNSUPPORTED_MEDIA", message: "Jellyfin 不接受当前头像文件类型" },
        },
        {
          code: "JELLYFIN_WRITE_FAILED",
          message: "上传 Jellyfin 人物头像失败",
        },
      );
    }
  }

  try {
    await networkClient.postContent(buildJellyfinUrl(configuration, `${primaryPath}/0`), bytes, { headers });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物头像上传请求" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法上传人物头像" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物头像写入权限" },
        415: { code: "JELLYFIN_UNSUPPORTED_MEDIA", message: "Jellyfin 不接受当前头像文件类型" },
      },
      {
        code: "JELLYFIN_WRITE_FAILED",
        message: "上传 Jellyfin 人物头像失败",
      },
    );
  }
};

export class JellyfinActorPhotoService {
  private readonly logger = loggerService.getLogger("JellyfinActorPhoto");

  private readonly networkClient: NetworkClient;

  private readonly actorMapUrl: string;

  constructor(private readonly deps: JellyfinActorPhotoDependencies) {
    this.networkClient = deps.networkClient;
    this.actorMapUrl = deps.actorMapUrl ?? DEFAULT_GFRIENDS_FILETREE_URL;
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    const persons = await fetchPersons(this.networkClient, configuration);
    const actorSources = await buildActorSourceIndex(configuration);
    const remoteActorMap = await this.loadActorMap();
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

      if (mode === "missing" && hasPrimaryImage(person)) {
        continue;
      }

      try {
        const actorSource = actorSources.get(normalizeActorName(person.Name));
        const actorNames = [person.Name, ...(actorSource?.aliases ?? [])];
        const localPhotoPath = await resolveLocalPhotoPath(configuration, [...actorNames]);
        const remotePhotoUrl = actorSource?.coverUrl ?? resolveRemoteActorPhotoUrl(remoteActorMap, actorNames);

        let content: Uint8Array | undefined;
        let contentType: string | undefined;

        if (localPhotoPath) {
          content = await readFile(localPhotoPath);
          contentType = contentTypeFromPath(localPhotoPath);
        } else if (remotePhotoUrl) {
          if (await hasFile(remotePhotoUrl)) {
            content = await readFile(remotePhotoUrl);
          } else {
            content = await this.networkClient.getContent(remotePhotoUrl, {
              headers: {
                accept: "image/*",
              },
            });
          }
          contentType = contentTypeFromPath(remotePhotoUrl);
        }

        if (!content || !contentType) {
          failedCount += 1;
          this.deps.signalService.showLogText(`No Jellyfin actor photo source found for ${person.Name}`, "warn");
          continue;
        }

        await uploadPrimaryImage(this.networkClient, configuration, person.Id, content, contentType);
        if (configuration.server.refreshPersonAfterSync) {
          try {
            await refreshPerson(this.networkClient, configuration, person.Id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to refresh Jellyfin actor ${person.Name} after photo sync: ${message}`);
          }
        }
        processedCount += 1;
        this.deps.signalService.showLogText(`Updated Jellyfin actor photo: ${person.Name}`);
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to update Jellyfin actor photo for ${person.Name}: ${message}`);
      }
    }

    this.deps.signalService.showLogText(
      `Jellyfin actor photo sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }

  private async loadActorMap(): Promise<Map<string, string>> {
    const rawBase = this.actorMapUrl.replace(/\/Filetree\.json$/u, "").replace(/\/+$/u, "");

    try {
      const payload = await this.networkClient.getJson<GfriendsResponse>(this.actorMapUrl);
      const map = new Map<string, string>();

      if (!payload.Content) {
        return map;
      }

      for (const [folder, files] of Object.entries(payload.Content)) {
        for (const [actorName, fileName] of Object.entries(files)) {
          if (!actorName || !fileName || map.has(actorName)) {
            continue;
          }
          map.set(actorName, `${rawBase}/Content/${folder}/${fileName}`);
        }
      }

      return map;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Failed to load remote actor photo map: ${message}`);
      return new Map<string, string>();
    }
  }
}
