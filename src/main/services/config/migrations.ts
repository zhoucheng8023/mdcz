/**
 * Configuration migration definitions.
 *
 * Each migration transforms a raw config object from one version to the next.
 * Migrations must be pure data transforms — no I/O, no side effects.
 *
 * When releasing a new stable version, old migrations can be removed once all
 * users have upgraded past the corresponding configVersion.
 */

export interface Migration {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (raw: Record<string, unknown>) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((e) => typeof e === "string");

/** Append items to an array field inside a nested section, only if not already present. */
const appendToArray = (raw: Record<string, unknown>, section: string, key: string, items: string[]): void => {
  const obj = raw[section];
  if (!isRecord(obj)) return;
  const arr = obj[key];
  if (!isStringArray(arr)) return;
  for (const item of items) {
    if (!arr.includes(item)) {
      arr.push(item);
    }
  }
};

/** Rename a key inside a nested section. */
const renameKey = (raw: Record<string, unknown>, section: string, oldKey: string, newKey: string): void => {
  const obj = raw[section];
  if (!isRecord(obj) || !(oldKey in obj)) return;
  if (!(newKey in obj)) {
    obj[newKey] = obj[oldKey];
  }
  delete obj[oldKey];
};

const DEFAULT_FOLDER_TEMPLATE = "{actor}/{number}";

const FIELD_PRIORITY_SITE_ADDITIONS: Record<string, string[]> = {
  title: ["km_produce", "avbase"],
  plot: ["avbase"],
  actors: ["km_produce", "avbase"],
  genres: ["km_produce", "avbase"],
  thumb_url: ["km_produce", "avbase"],
  poster_url: ["km_produce", "avbase"],
  sample_images: ["avbase"],
  studio: ["km_produce", "avbase"],
  director: ["avbase"],
  publisher: ["avbase"],
  series: ["avbase"],
  release_date: ["km_produce", "avbase"],
};

const appendPathSegment = (template: string, segment: string): string => {
  const trimmed = template.trim();
  if (!trimmed) {
    return DEFAULT_FOLDER_TEMPLATE;
  }
  if (trimmed.endsWith("/")) {
    return `${trimmed}${segment}`;
  }
  return `${trimmed}/${segment}`;
};

const migrateFolderTemplate = (raw: Record<string, unknown>): void => {
  const successFileMove =
    !isRecord(raw.behavior) || !("successFileMove" in raw.behavior) ? true : raw.behavior.successFileMove !== false;
  if (!successFileMove) {
    return;
  }

  const naming = raw.naming;
  if (!isRecord(naming) || !("folderTemplate" in naming)) {
    return;
  }

  const folderTemplate = naming.folderTemplate;
  if (typeof folderTemplate !== "string" || folderTemplate.trim() === "") {
    naming.folderTemplate = DEFAULT_FOLDER_TEMPLATE;
    return;
  }

  if (!folderTemplate.includes("{number}")) {
    naming.folderTemplate = appendPathSegment(folderTemplate, "{number}");
  }
};

// ── v0.3.0 → v0.4.0 ─────────────────────────────────────────────────────────

function migrateV030ToV040(raw: Record<string, unknown>): void {
  // 1. download.downloadCover → download.downloadThumb
  renameKey(raw, "download", "downloadCover", "downloadThumb");

  // 2. download.keepCover → download.keepThumb
  renameKey(raw, "download", "keepCover", "keepThumb");

  // 3. server → emby (url, apiKey, userId)
  const server = raw.server;
  if (isRecord(server)) {
    if (!isRecord(raw.emby)) raw.emby = {};
    const emby = raw.emby as Record<string, unknown>;

    for (const key of ["url", "apiKey", "userId"]) {
      if (key in server && !(key in emby)) {
        emby[key] = server[key];
      }
    }

    // 4. server.actorPhotoFolder → paths.actorPhotoFolder
    if (!isRecord(raw.paths)) raw.paths = {};
    const paths = raw.paths as Record<string, unknown>;
    if ("actorPhotoFolder" in server) {
      if (!("actorPhotoFolder" in paths)) {
        const value = server.actorPhotoFolder;
        paths.actorPhotoFolder = typeof value === "string" && value.trim() !== "" ? value : "actor_photo";
      }
    }

    delete raw.server;
  }

  // 5. aggregation.fieldPriorities.cover_url → .thumb_url
  const aggregation = raw.aggregation;
  if (isRecord(aggregation)) {
    renameKey(aggregation, "fieldPriorities", "cover_url", "thumb_url");
  }

  // 6. paths.sceneImagesFolder: "samples" → "extrafanart"
  const paths = raw.paths;
  if (isRecord(paths) && paths.sceneImagesFolder === "samples") {
    paths.sceneImagesFolder = "extrafanart";
  }

  // 7. Ensure folderTemplate stays valid under the new successFileMove rule
  migrateFolderTemplate(raw);

  // 8. Append new sites to enabledSites / siteOrder
  const scrape = raw.scrape;
  if (isRecord(scrape)) {
    if (isStringArray(scrape.enabledSites)) {
      for (const site of ["km_produce", "avbase"]) {
        if (!scrape.enabledSites.includes(site)) {
          scrape.enabledSites.push(site);
        }
      }
    }
    if (isStringArray(scrape.siteOrder)) {
      for (const site of ["km_produce", "avbase"]) {
        if (!scrape.siteOrder.includes(site)) {
          scrape.siteOrder.push(site);
        }
      }
    }
  }

  // 9. Append new sites to fieldPriorities arrays, matching current defaults
  if (isRecord(aggregation)) {
    const fp = aggregation.fieldPriorities;
    if (isRecord(fp)) {
      for (const [key, sites] of Object.entries(FIELD_PRIORITY_SITE_ADDITIONS)) {
        appendToArray(aggregation, "fieldPriorities", key, sites);
      }
    }
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const migrations: Migration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    description: "v0.3.0 → v0.4.0",
    migrate: migrateV030ToV040,
  },
];
