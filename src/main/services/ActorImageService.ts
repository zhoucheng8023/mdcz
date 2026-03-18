import type { ActorSourceHint, ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { mergeActorProfiles } from "@main/utils/actorProfile";
import type { ActorProfile } from "@shared/types";
import { ActorImageFileStore, type ActorImageLookupOptions } from "./actorImage/ActorImageFileStore";
import { ActorPhotoMaterializer } from "./actorImage/ActorPhotoMaterializer";
import { throwIfAborted } from "./scraper/abort";

export { getActorImageCacheDirectory } from "./actorImage/ActorImageFileStore";

export interface ActorImageServiceDependencies {
  networkClient?: Pick<NetworkClient, "getContent">;
}

type PrepareActorProfilesInput = {
  movieDir: string;
  actors: string[];
  actorProfiles?: ActorProfile[];
  actorPhotoBaseDir?: string;
  actorSourceProvider?: ActorSourceProvider;
  sourceHints?: ActorSourceHint[];
  signal?: AbortSignal;
};

type ResolvedActorImage = {
  profile: ActorProfile | undefined;
  imagePath: string | undefined;
};

const hasActorPhoto = (profile: ActorProfile | undefined): boolean => Boolean(profile?.photo_url?.trim());
const isRemoteUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

export class ActorImageService {
  private readonly logger = loggerService.getLogger("ActorImageService");

  private readonly fileStore: ActorImageFileStore;

  private readonly photoMaterializer: ActorPhotoMaterializer;

  constructor(deps: ActorImageServiceDependencies = {}) {
    this.fileStore = new ActorImageFileStore({
      logger: this.logger,
      networkClient: deps.networkClient,
    });
    this.photoMaterializer = new ActorPhotoMaterializer(this.logger);
  }

  async resolveLocalImage(
    configuration: Configuration,
    actorNames: string[],
    options: ActorImageLookupOptions = {},
  ): Promise<string | undefined> {
    return await this.fileStore.resolveLocalImage(configuration, actorNames, options);
  }

  async materializeForMovie(movieDir: string, actorName: string, sourcePath: string): Promise<string | undefined> {
    return await this.photoMaterializer.materializeForMovie(movieDir, actorName, sourcePath);
  }

  async prepareActorProfilesForMovie(
    configuration: Configuration,
    input: PrepareActorProfilesInput,
  ): Promise<ActorProfile[] | undefined> {
    throwIfAborted(input.signal);

    const seedProfilesByName = this.indexProfilesByName(input.actorProfiles);
    const preparedProfiles: ActorProfile[] = [];
    const seenActorNames = new Set<string>();

    for (const rawActorName of input.actors) {
      throwIfAborted(input.signal);

      const actorName = rawActorName.trim();
      const normalizedName = normalizeActorName(actorName);
      if (!normalizedName || seenActorNames.has(normalizedName)) {
        continue;
      }
      seenActorNames.add(normalizedName);

      const preparedProfile = await this.prepareActorProfileForMovie(
        configuration,
        actorName,
        seedProfilesByName.get(normalizedName),
        input,
      );
      preparedProfiles.push(preparedProfile);
    }

    return preparedProfiles.length > 0 ? preparedProfiles : undefined;
  }

  private async prepareActorProfileForMovie(
    configuration: Configuration,
    actorName: string,
    seedProfile: ActorProfile | undefined,
    input: PrepareActorProfilesInput,
  ): Promise<ActorProfile> {
    const resolvedActorImage = await this.resolveActorImagePath(configuration, actorName, seedProfile, input);

    throwIfAborted(input.signal);

    if (!resolvedActorImage.imagePath) {
      return {
        ...resolvedActorImage.profile,
        name: actorName,
        photo_url: undefined,
      };
    }

    const relativePhotoPath = await this.photoMaterializer.materializeForMovie(
      input.movieDir,
      actorName,
      resolvedActorImage.imagePath,
    );
    if (!relativePhotoPath) {
      this.logger.warn(`Failed to materialize actor photo for ${actorName} from ${resolvedActorImage.imagePath}`);
    }

    return {
      ...resolvedActorImage.profile,
      name: actorName,
      photo_url: relativePhotoPath,
    };
  }

  private async resolveActorImagePath(
    configuration: Configuration,
    actorName: string,
    seedProfile: ActorProfile | undefined,
    input: PrepareActorProfilesInput,
  ): Promise<ResolvedActorImage> {
    let workingProfile = seedProfile;
    let lookupNames = this.buildLookupNames(actorName, workingProfile);
    let resolvedImagePath = await this.resolveStoredImage(configuration, lookupNames, input, workingProfile?.photo_url);

    if (!resolvedImagePath) {
      workingProfile = await this.resolveActorProfile(
        configuration,
        actorName,
        seedProfile,
        input.actorSourceProvider,
        input.sourceHints,
        input.signal,
      );
      lookupNames = this.buildLookupNames(actorName, workingProfile);
      resolvedImagePath = await this.resolveStoredImage(configuration, lookupNames, input, workingProfile?.photo_url);
    }

    if (!resolvedImagePath) {
      resolvedImagePath = await this.fileStore.cacheActorImage(
        configuration,
        lookupNames,
        workingProfile?.photo_url,
        {
          fallbackBaseDir: input.actorPhotoBaseDir,
        },
        input.signal,
      );
    }

    if (!resolvedImagePath) {
      const refreshedProfile = await this.resolveActorProfile(
        configuration,
        actorName,
        workingProfile,
        input.actorSourceProvider,
        input.sourceHints,
        input.signal,
        { forceLookup: true },
      );

      if (refreshedProfile?.photo_url && refreshedProfile.photo_url !== workingProfile?.photo_url) {
        workingProfile = refreshedProfile;
        lookupNames = this.buildLookupNames(actorName, workingProfile);
        resolvedImagePath = await this.resolveStoredImage(configuration, lookupNames, input, workingProfile.photo_url);

        if (!resolvedImagePath) {
          resolvedImagePath = await this.fileStore.cacheActorImage(
            configuration,
            lookupNames,
            workingProfile.photo_url,
            {
              fallbackBaseDir: input.actorPhotoBaseDir,
            },
            input.signal,
          );
        }
      }
    }

    return {
      profile: workingProfile,
      imagePath: resolvedImagePath,
    };
  }

  private buildLookupNames(actorName: string, profile: ActorProfile | undefined): string[] {
    return toUniqueActorNames([actorName, profile?.name, ...(profile?.aliases ?? [])]);
  }

  private async resolveStoredImage(
    configuration: Configuration,
    lookupNames: string[],
    input: PrepareActorProfilesInput,
    photoUrl: string | undefined,
  ): Promise<string | undefined> {
    return await this.fileStore.resolveLocalImage(configuration, lookupNames, {
      fallbackBaseDir: input.actorPhotoBaseDir,
      expectedRemoteUrl: this.toExpectedRemoteUrl(photoUrl),
    });
  }

  private toExpectedRemoteUrl(photoUrl: string | undefined): string | undefined {
    return isRemoteUrl(photoUrl ?? "") ? photoUrl : undefined;
  }

  private indexProfilesByName(actorProfiles: ActorProfile[] | undefined): Map<string, ActorProfile> {
    const profilesByName = new Map<string, ActorProfile>();

    for (const profile of actorProfiles ?? []) {
      const lookupNames = toUniqueActorNames([profile.name, ...(profile.aliases ?? [])]);
      for (const lookupName of lookupNames) {
        const normalizedName = normalizeActorName(lookupName);
        if (!normalizedName) {
          continue;
        }

        profilesByName.set(normalizedName, profile);
      }
    }

    return profilesByName;
  }

  private async resolveActorProfile(
    configuration: Configuration,
    actorName: string,
    existingProfile: ActorProfile | undefined,
    actorSourceProvider?: ActorSourceProvider,
    sourceHints?: ActorSourceHint[],
    signal?: AbortSignal,
    options: { forceLookup?: boolean } = {},
  ): Promise<ActorProfile | undefined> {
    if ((!options.forceLookup && hasActorPhoto(existingProfile)) || !actorSourceProvider) {
      return existingProfile;
    }

    throwIfAborted(signal);

    const lookup = await actorSourceProvider.lookup(configuration, {
      name: actorName,
      aliases: existingProfile?.aliases,
      requiredField: "photo_url",
      sourceHints,
    });

    throwIfAborted(signal);

    if (lookup.profile.photo_url) {
      this.logger.info(
        `Resolved actor photo URL for ${actorName} from ${lookup.profileSources.photo_url ?? "unknown"}: ${lookup.profile.photo_url}`,
      );
    }

    return (
      mergeActorProfiles(
        [
          { name: actorName, aliases: existingProfile?.aliases },
          ...(options.forceLookup ? [lookup.profile, existingProfile] : [existingProfile, lookup.profile]),
        ].filter((profile): profile is ActorProfile => Boolean(profile)),
      ) ?? existingProfile
    );
  }
}
