import type { Configuration } from "@main/services/config";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { ACTOR_PROFILE_METADATA_FIELDS, hasActorProfileFieldValue } from "@main/utils/actorProfile";
import type { ActorProfile } from "@shared/types";
import type { ActorLookupQuery, ActorLookupResult, ActorSourceName, ActorSourceResult } from "./types";

const pickProfileField = (
  results: ActorSourceResult[],
  order: readonly ActorSourceName[],
  field: (typeof ACTOR_PROFILE_METADATA_FIELDS)[number],
): { source?: ActorSourceName; value?: ActorProfile[typeof field] } => {
  for (const sourceName of order) {
    const result = results.find((entry) => entry.source === sourceName && entry.success);
    const value = result?.profile?.[field];
    if (hasActorProfileFieldValue(value)) {
      return { source: sourceName, value };
    }
  }

  return {};
};

export class ActorProfileAggregator {
  aggregate(configuration: Configuration, query: ActorLookupQuery, results: ActorSourceResult[]): ActorLookupResult {
    const profiles = results.flatMap((result) => (result.success && result.profile ? [result.profile] : []));
    const mergedName = profiles.find((profile) => profile.name.trim())?.name.trim() ?? query.name.trim();
    const aliases = toUniqueActorNames([
      ...(query.aliases ?? []),
      ...profiles.flatMap((profile) => profile.aliases ?? []),
    ]).filter((alias) => normalizeActorName(alias) !== normalizeActorName(mergedName));

    const profile: ActorProfile = {
      name: mergedName,
      aliases: aliases.length > 0 ? aliases : undefined,
    };

    const profileSources: Partial<Record<(typeof ACTOR_PROFILE_METADATA_FIELDS)[number], ActorSourceName>> = {};

    for (const field of ACTOR_PROFILE_METADATA_FIELDS) {
      const order: readonly ActorSourceName[] =
        field === "photo_url"
          ? configuration.personSync.personImageSources
          : configuration.personSync.personOverviewSources;
      const picked = pickProfileField(results, order, field);
      if (!hasActorProfileFieldValue(picked.value)) {
        continue;
      }

      Object.assign(profile, { [field]: picked.value });
      if (picked.source) {
        profileSources[field] = picked.source;
      }
    }

    return {
      profile,
      profileSources,
      sourceResults: results,
      warnings: results.flatMap((result) => result.warnings),
    };
  }
}
