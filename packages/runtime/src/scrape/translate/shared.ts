import { convertToSimplified, convertToTraditional } from "../../shared";
import type { LanguageTarget } from "./types";

export const normalizeNewlines = (value: string): string => value.replace(/\r\n?/gu, "\n");

export const normalizeTermKey = (value: string): string => {
  return value.normalize("NFKC").trim().toLowerCase();
};

export const ensureTargetChinese = (text: string, target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return convertToTraditional(text);
  }

  return convertToSimplified(text);
};

export const getTargetLanguageLabel = (target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return "繁体中文";
  }
  return "简体中文";
};
