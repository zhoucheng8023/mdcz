import { Website } from "@shared/enums";
import type { OfficialActorSourceDependencies } from "../types";
import { BaseFalenoLikeOfficialAdapter } from "./BaseFalenoLikeOfficialAdapter";

const FALENO_BASE_URL = "https://faleno.jp";
const FALENO_STUDIO_PATTERN = /(faleno|ファレノ)/iu;

export class FalenoOfficialAdapter extends BaseFalenoLikeOfficialAdapter {
  constructor(deps: OfficialActorSourceDependencies) {
    super(deps, {
      key: "faleno",
      baseUrl: FALENO_BASE_URL,
      hintHosts: ["faleno.jp"],
      rateLimitedHosts: ["faleno.jp"],
      rosterPath: "/top/actress/",
      website: Website.FALENO,
      studio: "FALENO",
      studioPattern: FALENO_STUDIO_PATTERN,
    });
  }
}
