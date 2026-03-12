import { dirname, join } from "node:path";
import type { ActorImageService } from "@main/services/ActorImageService";
import type { Configuration } from "@main/services/config";
import type { ActorProfile, CrawlerData } from "@shared/types";

const isRemoteActorPhoto = (value: string): boolean => /^https?:\/\//iu.test(value);

const toLocalActorPhotoPaths = (movieDir: string, actorProfiles: ActorProfile[] | undefined): string[] => {
  const resolvedPaths: string[] = [];
  const seen = new Set<string>();

  for (const profile of actorProfiles ?? []) {
    const photoUrl = profile.photo_url?.trim();
    if (!photoUrl || isRemoteActorPhoto(photoUrl)) {
      continue;
    }

    const resolvedPath = join(movieDir, photoUrl);
    if (seen.has(resolvedPath)) {
      continue;
    }

    seen.add(resolvedPath);
    resolvedPaths.push(resolvedPath);
  }

  return resolvedPaths;
};

export const prepareCrawlerDataForNfo = async (
  actorImageService: ActorImageService,
  configuration: Configuration,
  crawlerData: CrawlerData,
  options: {
    movieDir: string;
    sourceVideoPath: string;
  },
): Promise<{ data: CrawlerData; actorPhotoPaths: string[] }> => {
  const actorProfiles = await actorImageService.prepareActorProfilesForMovie(configuration, {
    movieDir: options.movieDir,
    actors: crawlerData.actors,
    actorProfiles: crawlerData.actor_profiles,
    actorPhotoBaseDir: dirname(options.sourceVideoPath),
  });

  return {
    data: {
      ...crawlerData,
      actor_profiles: actorProfiles,
    },
    actorPhotoPaths: toLocalActorPhotoPaths(options.movieDir, actorProfiles),
  };
};
