export type WorkbenchSetupMode = "scrape" | "maintenance";

export const resolveMediaCandidateExcludeDir = (
  mode: WorkbenchSetupMode,
  targetDir: string | undefined,
): string | undefined => {
  const trimmedTargetDir = targetDir?.trim() ?? "";
  if (mode !== "scrape" || !trimmedTargetDir) {
    return undefined;
  }

  return trimmedTargetDir;
};
