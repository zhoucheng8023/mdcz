import type { Website } from "@shared/enums";
import type { ActorSourceHint } from "../../../types";
import { BaseRosterOfficialAdapter } from "../BaseRosterOfficialAdapter";
import { matchesSourceHost } from "../shared";
import type { OfficialActorSourceDependencies } from "../types";

interface StudioOfficialAdapterConfig {
  hintHosts: string[];
  key: string;
  rateLimitedHosts: string[];
  studioPattern?: RegExp;
  website: Website;
}

export abstract class BaseStudioOfficialAdapter<TRoster> extends BaseRosterOfficialAdapter<TRoster> {
  protected constructor(
    deps: OfficialActorSourceDependencies,
    private readonly config: StudioOfficialAdapterConfig,
  ) {
    super(deps, {
      key: config.key,
      rateLimitedHosts: config.rateLimitedHosts,
    });
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) =>
        hint.website === this.config.website ||
        (this.config.studioPattern?.test(hint.studio ?? "") ?? false) ||
        (this.config.studioPattern?.test(hint.publisher ?? "") ?? false) ||
        this.config.hintHosts.some((host) => matchesSourceHost(hint, host)),
    );
  }
}
