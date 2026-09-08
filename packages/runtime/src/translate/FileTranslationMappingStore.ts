import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActorMappingLanguageTarget, LanguageTarget, TranslationMappingStore } from "../scrape/translate/types";

type MappingCategory = "actor" | "genre";

interface MappingEntry {
  zh_cn: string;
  zh_tw: string;
  jp: string;
  keywords: string[];
}

interface ActorMappingRow {
  canonical: string;
  aliases: string[];
}

interface GenreMappingRow {
  zh_cn: string;
  zh_tw: string;
  jp: string;
  keywords: string[];
}

const MAPPING_FILE: Record<MappingCategory, string> = {
  actor: "mapping_actor.json",
  genre: "mapping_info.json",
};

const normalizeKeyword = (input: string): string => input.normalize("NFC").trim().toUpperCase();

export class FileTranslationMappingStore implements TranslationMappingStore {
  private loaded = false;
  private actorIndex = new Map<string, MappingEntry>();
  private genreIndex = new Map<string, MappingEntry>();

  constructor(private readonly directory: string) {}

  async findMappedActorName(value: string, language: ActorMappingLanguageTarget = "zh_cn"): Promise<string | null> {
    return await this.lookup(value, "actor", language);
  }

  async findMappedGenreName(value: string, language: LanguageTarget = "zh_cn"): Promise<string | null> {
    return await this.lookup(value, "genre", language);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    const [actorDocument, genreDocument] = await Promise.all([
      readFile(join(this.directory, MAPPING_FILE.actor), "utf8"),
      readFile(join(this.directory, MAPPING_FILE.genre), "utf8"),
    ]);
    const actorRows = (JSON.parse(actorDocument) as { entries: ActorMappingRow[] }).entries;
    const genreRows = (JSON.parse(genreDocument) as { entries: GenreMappingRow[] }).entries;
    const actors = actorRows.map(({ canonical, aliases }) => ({
      zh_cn: canonical,
      zh_tw: canonical,
      jp: canonical,
      keywords: [...aliases, canonical].map(normalizeKeyword),
    }));
    const genres = genreRows.map((row) => ({
      zh_cn: row.zh_cn,
      zh_tw: row.zh_tw,
      jp: row.jp,
      keywords: row.keywords.map(normalizeKeyword),
    }));

    this.actorIndex = this.buildIndex(actors);
    this.genreIndex = this.buildIndex(genres);
    this.loaded = true;
  }

  private buildIndex(entries: MappingEntry[]): Map<string, MappingEntry> {
    const index = new Map<string, MappingEntry>();
    for (const entry of entries) {
      for (const keyword of entry.keywords) {
        if (!index.has(keyword)) index.set(keyword, entry);
      }
    }
    return index;
  }

  private async lookup(
    value: string,
    category: MappingCategory,
    language: ActorMappingLanguageTarget,
  ): Promise<string | null> {
    await this.ensureLoaded();
    const entry = (category === "actor" ? this.actorIndex : this.genreIndex).get(normalizeKeyword(value));
    if (!entry) return null;

    const mapped =
      language === "zh_tw"
        ? entry.zh_tw || entry.zh_cn
        : language === "jp"
          ? entry.jp || entry.zh_cn
          : entry.zh_cn || entry.zh_tw;
    const cleaned = mapped.replaceAll("删除", "").trim();
    return category === "genre" ? cleaned : cleaned || null;
  }
}
