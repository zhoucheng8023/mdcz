import type { TranslationTarget } from "@mdcz/shared/enums";

export type LanguageTarget = "zh_cn" | "zh_tw";
export type ActorMappingLanguageTarget = LanguageTarget | "jp";

export interface TranslationMappingStore {
  findMappedActorName(value: string, language?: ActorMappingLanguageTarget): Promise<string | null>;
  // An empty mapping removes a genre; null means the term is unmapped.
  findMappedGenreName(value: string, language?: LanguageTarget): Promise<string | null>;
}

export const toTarget = (value: TranslationTarget): LanguageTarget => {
  if (value === "zh-TW") {
    return "zh_tw";
  }
  return "zh_cn";
};
