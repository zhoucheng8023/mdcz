import { parse } from "node:path";
import { extractNumber } from "@main/utils/number";

const FC2_SPECIAL_FEATURE_HINTS = ["花絮", "おまけ", "特典"];

export const isGeneratedSidecarVideo = (filePath: string): boolean => {
  const rawName = parse(filePath).name.normalize("NFC");
  const normalizedName = rawName.toLowerCase();
  if (normalizedName === "trailer") {
    return true;
  }

  if (!extractNumber(rawName).toUpperCase().startsWith("FC2-")) {
    return false;
  }

  return FC2_SPECIAL_FEATURE_HINTS.some((hint) => normalizedName.includes(hint));
};
