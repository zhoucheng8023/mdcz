import type { Configuration } from "@mdcz/shared/config";
import { throwIfAborted } from "../utils/abort";
import { ensureTargetChinese, normalizeTermKey } from "./shared";
import type { LanguageTarget, TranslationMappingStore } from "./types";

type TranslateTextFn = (
  input: string,
  target: LanguageTarget,
  config: Configuration,
  signal?: AbortSignal,
) => Promise<string>;

type TranslateGenresFn = (genres: string[]) => Promise<string[] | null>;

export class GenreTranslator {
  private readonly cache = new Map<string, string>();

  constructor(private readonly mappingStore?: TranslationMappingStore) {}

  async translateTerms(
    terms: string[],
    target: LanguageTarget,
    config: Configuration,
    translateText: TranslateTextFn,
    translateGenres: TranslateGenresFn,
    signal?: AbortSignal,
  ): Promise<string[]> {
    throwIfAborted(signal);

    const normalizedTerms = terms.map((term) => term.trim());
    const resolvedByKey = new Map<string, string>();
    const unresolvedByKey = new Map<string, string>();

    for (const term of normalizedTerms) {
      if (!term) continue;
      const key = `${target}:${normalizeTermKey(term)}`;
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        resolvedByKey.set(key, cached);
        continue;
      }
      if (unresolvedByKey.has(key)) continue;

      const mapped = await this.mappingStore?.findMappedGenreName(term, target);
      if (mapped) {
        const normalized = ensureTargetChinese(mapped.trim(), target);
        this.cache.set(key, normalized);
        resolvedByKey.set(key, normalized);
      } else {
        unresolvedByKey.set(key, term);
      }
    }

    const unresolvedEntries = [...unresolvedByKey.entries()];
    if (config.translate.engine === "google") {
      await Promise.all(
        unresolvedEntries.map(async ([key, term]) => {
          const translated = await translateText(term, target, config, signal);
          const normalized = ensureTargetChinese(translated.trim(), target) || term;
          this.cache.set(key, normalized);
          resolvedByKey.set(key, normalized);
        }),
      );
    } else {
      const translated = await translateGenres(unresolvedEntries.map(([, term]) => term));
      if (translated && translated.length === unresolvedEntries.length) {
        unresolvedEntries.forEach(([key, term], index) => {
          const normalized = ensureTargetChinese(translated[index]?.trim() ?? "", target) || term;
          this.cache.set(key, normalized);
          resolvedByKey.set(key, normalized);
        });
      }
    }

    return normalizedTerms.map((term) => {
      if (!term) return "";
      return resolvedByKey.get(`${target}:${normalizeTermKey(term)}`) ?? term;
    });
  }
}
