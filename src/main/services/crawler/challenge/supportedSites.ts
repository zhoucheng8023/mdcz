import { Website } from "@shared/enums";

const CLOUDFLARE_CHALLENGE_SITES = new Set<Website>([Website.AVWIKIDB, Website.JAVDB, Website.FC2HUB]);

export const supportsCloudflareChallengeSite = (site: Website): boolean => CLOUDFLARE_CHALLENGE_SITES.has(site);
