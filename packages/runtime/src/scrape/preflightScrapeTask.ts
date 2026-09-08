import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, join, parse, relative, resolve } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { resolveOrganizeDirectory, type ScrapeExecutionMode } from "./FileOrganizer";
import { isGeneratedSidecarVideo } from "./media/generatedSidecarVideos";
import { parseNfo } from "./nfo";
import { DEFAULT_VIDEO_EXTENSIONS, isPathInside } from "./utils/filesystem";
import { extractNumber, parseFileInfo } from "./utils/number";

export interface ScrapeTargetConflict {
  number: string;
  part?: number;
  sourcePath: string;
  targetPath: string;
}

export class ScrapeTargetConflictError extends Error {
  constructor(readonly conflicts: readonly ScrapeTargetConflict[]) {
    super(
      "目标区域已有同番号、同分片的影片，或本次选择中存在重复影片。本次待处理影片均未开始刮削，请处理以下冲突后重试。\n\n" +
        conflicts
          .map(
            (conflict) =>
              `${conflict.number}${conflict.part ? ` · 分片 ${conflict.part}` : ""}\n待处理：${conflict.sourcePath}\n冲突文件：${conflict.targetPath}`,
          )
          .join("\n\n"),
    );
    this.name = "ScrapeTargetConflictError";
  }
}

export const preflightScrapeTask = async (input: {
  files: readonly { sourcePath: string; outputBaseDirectory?: string }[];
  configuration: Configuration;
  executionMode: ScrapeExecutionMode;
}): Promise<void> => {
  const { configuration } = input;
  const conflicts: ScrapeTargetConflict[] = [];
  const scopes = new Map<
    string,
    { directory: string; recursive: boolean; files: Map<string, Array<{ path: string; realPath: string }>> }
  >();
  for (const file of input.files) {
    const sourcePath = resolve(file.sourcePath);
    if (isGeneratedSidecarVideo(sourcePath)) continue;
    const info = parseFileInfo(sourcePath, configuration.scrape.filenameIgnoreTokens);
    const { directory, useFolderTemplate } = resolveOrganizeDirectory(sourcePath, configuration, {
      executionMode: input.executionMode,
      outputBaseDirectory: file.outputBaseDirectory,
    });
    const key = `${directory}\0${useFolderTemplate}`;
    let scope = scopes.get(key);
    if (!scope) {
      scope = { directory, recursive: useFolderTemplate, files: new Map() };
      scopes.set(key, scope);
    }
    const realPath = await realpath(sourcePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return sourcePath;
      throw error;
    });
    const identity = `${info.number}\0${info.part?.number ?? ""}`;
    const siblings = scope.files.get(identity) ?? [];
    const duplicate = siblings.find((other) => other.realPath !== realPath);
    if (duplicate) {
      conflicts.push({ number: info.number, part: info.part?.number, sourcePath, targetPath: duplicate.path });
    }
    siblings.push({ path: sourcePath, realPath });
    scope.files.set(identity, siblings);
  }

  const metadataRoot = configuration.paths.metadataPath.trim();
  for (const scope of scopes.values()) {
    const directories = [scope.directory];
    const visited = new Set<string>();
    for (const directory of directories) {
      if (metadataRoot && !isPathInside(metadataRoot, scope.directory) && isPathInside(metadataRoot, directory))
        continue;
      let entries: Dirent[];
      try {
        const key = await realpath(directory);
        if (visited.has(key)) continue;
        visited.add(key);
        entries = await readdir(directory, { encoding: "utf8", withFileTypes: true });
      } catch (error) {
        if (directory === scope.directory && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new Error(`无法检查目标目录：${directory}。本次待处理影片均未开始刮削。`, { cause: error });
      }
      for (const entry of entries) {
        const targetPath = join(directory, entry.name);
        const kind = entry.isSymbolicLink() ? await stat(targetPath) : entry;
        if (kind.isDirectory()) {
          if (scope.recursive) directories.push(targetPath);
          continue;
        }
        if (!kind.isFile() || !DEFAULT_VIDEO_EXTENSIONS.has(extname(targetPath).toLowerCase())) continue;
        if (isGeneratedSidecarVideo(targetPath)) continue;
        const info = parseFileInfo(targetPath, configuration.scrape.filenameIgnoreTokens);
        let number = info.number;
        let matches = scope.files.get(`${number}\0${info.part?.number ?? ""}`);
        if (!configuration.naming.fileTemplate.includes("{number}") && !matches) {
          const stem = info.part ? parse(targetPath).name.replace(info.part.suffix, "") : parse(targetPath).name;
          const nfoPaths = [join(directory, `${stem}.nfo`), join(directory, "movie.nfo")];
          if (metadataRoot && configuration.paths.mediaPath.trim()) {
            const mirrorDir = join(metadataRoot, relative(configuration.paths.mediaPath, directory));
            nfoPaths.push(join(mirrorDir, `${stem}.nfo`), join(mirrorDir, "movie.nfo"));
          }
          for (const nfoPath of nfoPaths) {
            const xml = await readFile(nfoPath, "utf8").catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            });
            if (xml === undefined) continue;
            number = extractNumber(parseNfo(xml, targetPath).number, configuration.scrape.filenameIgnoreTokens);
            matches = scope.files.get(`${number}\0${info.part?.number ?? ""}`);
            break;
          }
        }
        if (!matches) continue;
        const targetRealPath = await realpath(targetPath);
        for (const source of matches) {
          if (source.realPath === targetRealPath) continue;
          conflicts.push({ number, part: info.part?.number, sourcePath: source.path, targetPath });
        }
      }
    }
  }
  if (conflicts.length) {
    const unique = new Map(conflicts.map((conflict) => [`${conflict.sourcePath}\0${conflict.targetPath}`, conflict]));
    throw new ScrapeTargetConflictError([...unique.values()]);
  }
};
