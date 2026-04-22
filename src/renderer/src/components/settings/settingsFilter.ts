import {
  FIELD_REGISTRY,
  type FieldAnchor,
  type FieldEntry,
  SECTION_DESCRIPTIONS,
  SECTION_FILTER_ALIASES,
  SECTION_LABELS,
} from "./settingsRegistry";

export interface ParsedSettingsQuery {
  raw: string;
  textTerms: string[];
  groupTerms: string[];
  idTerms: string[];
  modified: boolean;
  advanced: boolean;
  hasFilters: boolean;
}

export interface SettingsFilterState {
  parsedQuery: ParsedSettingsQuery;
  showAdvanced: boolean;
  modifiedKeys: ReadonlySet<string>;
}

export interface SettingsSuggestion {
  id: string;
  kind: "token" | "group" | "id";
  label: string;
  insertValue: string;
  description: string;
}

const TOKEN_ADVANCED = "@advanced";
const TOKEN_MODIFIED = "@modified";
const TOKEN_GROUP = "@group:";
const TOKEN_ID = "@id:";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

function entrySearchText(entry: FieldEntry): string {
  const sectionLabel = SECTION_LABELS[entry.anchor];
  const sectionDescription = SECTION_DESCRIPTIONS[entry.anchor];
  const aliases = SECTION_FILTER_ALIASES[entry.anchor];
  return normalize(
    [entry.label, entry.description, ...entry.aliases, sectionLabel, sectionDescription, ...aliases].join(" "),
  );
}

function matchesGroup(anchor: FieldAnchor, term: string): boolean {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) {
    return true;
  }

  const sectionLabel = normalize(SECTION_LABELS[anchor]);
  const candidates = [anchor.toLowerCase(), sectionLabel, ...SECTION_FILTER_ALIASES[anchor].map(normalize)];
  return candidates.some((candidate) => candidate.includes(normalizedTerm));
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function parseSettingsQuery(query: string): ParsedSettingsQuery {
  const tokens = tokenize(query);
  const textTerms: string[] = [];
  const groupTerms: string[] = [];
  const idTerms: string[] = [];
  let modified = false;
  let advanced = false;

  for (const token of tokens) {
    const normalizedToken = normalize(token);
    if (!normalizedToken) {
      continue;
    }

    if (normalizedToken === TOKEN_ADVANCED) {
      advanced = true;
      continue;
    }

    if (normalizedToken === TOKEN_MODIFIED) {
      modified = true;
      continue;
    }

    if (normalizedToken.startsWith(TOKEN_GROUP)) {
      const value = normalizedToken.slice(TOKEN_GROUP.length);
      if (value) {
        groupTerms.push(value);
      }
      continue;
    }

    if (normalizedToken.startsWith(TOKEN_ID)) {
      const value = normalizedToken.slice(TOKEN_ID.length);
      if (value) {
        idTerms.push(value);
      }
      continue;
    }

    textTerms.push(normalizedToken);
  }

  return {
    raw: query,
    textTerms,
    groupTerms,
    idTerms,
    modified,
    advanced,
    hasFilters: textTerms.length > 0 || groupTerms.length > 0 || idTerms.length > 0 || modified || advanced,
  };
}

export function isIdTargetMatch(entry: FieldEntry, parsedQuery: ParsedSettingsQuery): boolean {
  return (
    parsedQuery.idTerms.length > 0 && parsedQuery.idTerms.every((term) => entry.key.toLowerCase().startsWith(term))
  );
}

export function isFieldVisible(entry: FieldEntry, state: SettingsFilterState): boolean {
  const { parsedQuery, showAdvanced, modifiedKeys } = state;
  const isModified = modifiedKeys.has(entry.key);
  const targetedById = isIdTargetMatch(entry, parsedQuery);
  const canRevealAdvanced =
    showAdvanced || parsedQuery.advanced || targetedById || (parsedQuery.modified && isModified);

  if (entry.surface !== "settings" || entry.visibility === "hidden") {
    return false;
  }

  if (entry.visibility === "advanced" && !canRevealAdvanced) {
    return false;
  }

  if (parsedQuery.modified && !isModified) {
    return false;
  }

  if (parsedQuery.groupTerms.length > 0 && !parsedQuery.groupTerms.every((term) => matchesGroup(entry.anchor, term))) {
    return false;
  }

  if (parsedQuery.idTerms.length > 0 && !targetedById) {
    return false;
  }

  if (parsedQuery.textTerms.length > 0) {
    const haystack = entrySearchText(entry);
    if (!parsedQuery.textTerms.every((term) => haystack.includes(term))) {
      return false;
    }
  }

  return true;
}

export function getVisibleEntries(entries: FieldEntry[], state: SettingsFilterState): FieldEntry[] {
  return entries.filter((entry) => isFieldVisible(entry, state));
}

export function replaceLastToken(query: string, replacement: string): string {
  const trimmedEnd = query.replace(/\s+$/u, "");
  if (!trimmedEnd) {
    return `${replacement} `;
  }

  const tokenStart = trimmedEnd.lastIndexOf(" ");
  const prefix = tokenStart === -1 ? "" : `${trimmedEnd.slice(0, tokenStart + 1)}`;
  return `${prefix}${replacement} `;
}

export function removeToken(query: string, token: string): string {
  return tokenize(query)
    .filter((item) => normalize(item) !== normalize(token))
    .join(" ");
}

function getActiveToken(query: string): string {
  if (!query || /\s$/u.test(query)) {
    return "";
  }

  const tokens = query.split(/\s+/u);
  return tokens.at(-1) ?? "";
}

function buildGroupSuggestions(prefix: string): SettingsSuggestion[] {
  return Object.entries(SECTION_LABELS)
    .filter(
      ([anchor, label]) => matchesGroup(anchor as FieldAnchor, prefix) || normalize(label).includes(normalize(prefix)),
    )
    .map(([anchor, label]) => ({
      id: `group:${anchor}`,
      kind: "group" as const,
      label: `按分组筛选: ${label}`,
      insertValue: `${TOKEN_GROUP}${label}`,
      description: SECTION_DESCRIPTIONS[anchor as FieldAnchor],
    }));
}

function buildIdSuggestions(prefix: string): SettingsSuggestion[] {
  const normalizedPrefix = normalize(prefix);
  return FIELD_REGISTRY.filter((entry) => entry.key.toLowerCase().includes(normalizedPrefix))
    .slice(0, 8)
    .map((entry) => ({
      id: `id:${entry.key}`,
      kind: "id" as const,
      label: entry.key,
      insertValue: `${TOKEN_ID}${entry.key}`,
      description: `${SECTION_LABELS[entry.anchor]} · ${entry.label}`,
    }));
}

export function getSettingsSuggestions(query: string): SettingsSuggestion[] {
  const activeToken = getActiveToken(query);
  const normalizedToken = normalize(activeToken);

  if (!normalizedToken.startsWith("@")) {
    return [];
  }

  if (normalizedToken.startsWith(TOKEN_ID)) {
    return buildIdSuggestions(normalizedToken.slice(TOKEN_ID.length));
  }

  if (normalizedToken.startsWith(TOKEN_GROUP)) {
    return buildGroupSuggestions(normalizedToken.slice(TOKEN_GROUP.length));
  }

  const tokenSuggestions: SettingsSuggestion[] = [
    {
      id: TOKEN_ADVANCED,
      kind: "token" as const,
      label: TOKEN_ADVANCED,
      insertValue: TOKEN_ADVANCED,
      description: "显示公共高级设置",
    },
    {
      id: TOKEN_MODIFIED,
      kind: "token" as const,
      label: TOKEN_MODIFIED,
      insertValue: TOKEN_MODIFIED,
      description: "仅显示已偏离默认值的设置",
    },
    {
      id: TOKEN_ID,
      kind: "token" as const,
      label: TOKEN_ID,
      insertValue: TOKEN_ID,
      description: "按设置键精确定位，例如 @id:translate.llmApiKey",
    },
    {
      id: TOKEN_GROUP,
      kind: "token" as const,
      label: TOKEN_GROUP,
      insertValue: TOKEN_GROUP,
      description: "按分组筛选，例如 @group:数据源",
    },
  ].filter((suggestion) => suggestion.label.startsWith(normalizedToken));

  return [...tokenSuggestions, ...buildGroupSuggestions(normalizedToken.slice(1))].slice(0, 8);
}
