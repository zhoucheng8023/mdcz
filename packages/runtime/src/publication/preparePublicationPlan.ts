import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { type AssetNamingMode, buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { OrganizePlan } from "../scrape/FileOrganizer";
import {
  buildGeneratedVideoSidecarTargetPath,
  buildSubtitleSidecarTargetPath,
  findGeneratedVideoSidecars,
  isGeneratedSidecarVideo,
} from "../scrape/media";
import { getNfoWritePaths } from "../scrape/nfo";
import { listVideoFiles } from "../scrape/utils/filesystem";
import { prepareMovedStrmContent, prepareStrmMirrorContent } from "../scrape/utils/strm";
import type { PreparedPublicationPlan } from "./types";

export const preparePublicationPlan = async (input: {
  sourceVideoPath: string;
  outputVideoPath: string;
  stagingDir?: string;
  existingAssetDir: string;
  metadataOutputDir: string;
  downloadedAssets: DownloadedAssets;
  actorPhotoPaths: string[];
  existingAssets?: DiscoveredAssets;
  existingNfoPath?: string;
  existingStrmPath?: string;
  movingVideoPaths?: readonly string[];
  assetDecisions?: MaintenanceAssetDecisions;
  organizePlan?: OrganizePlan;
  organizeFiles?: boolean;
  nfoNaming: "both" | "movie" | "filename";
  assetNamingMode?: AssetNamingMode;
  reuseNfo?: boolean;
  remoteData?: CrawlerData;
  writeNfo(
    assets: DownloadedAssets,
    writeFile: (path: string, content: string) => Promise<void>,
  ): Promise<string | undefined>;
}): Promise<{ plan: PreparedPublicationPlan; assets: DiscoveredAssets; nfoPath?: string }> => {
  const artifacts: PreparedPublicationPlan["artifacts"] = [];
  const sidecars: NonNullable<PreparedPublicationPlan["sidecars"]> = [];
  const obsolete = new Set<string>();
  const mapped = new Map<string, string>();
  const existing = input.existingAssets;
  const downloaded = input.downloadedAssets;
  const organizeFiles = input.organizeFiles !== false;
  const assetFileNames = input.assetNamingMode
    ? buildMovieAssetFileNames(
        basename(
          input.organizePlan?.nfoPath ?? input.outputVideoPath,
          input.organizePlan ? ".nfo" : parse(input.outputVideoPath).ext,
        ),
        input.assetNamingMode,
      )
    : undefined;
  const moving = new Set((input.movingVideoPaths ?? [input.sourceVideoPath]).map((path) => resolve(path)));
  const preserveSharedSources =
    organizeFiles &&
    input.organizePlan &&
    (await listVideoFiles(dirname(input.sourceVideoPath), false)).some(
      (path) => !moving.has(resolve(path)) && !isGeneratedSidecarVideo(path),
    );
  const protectedSources = new Set<string>();
  if (preserveSharedSources) {
    for (const path of [
      input.existingNfoPath,
      input.existingNfoPath && join(dirname(input.existingNfoPath), "movie.nfo"),
      existing?.thumb,
      existing?.poster,
      existing?.fanart,
      existing?.trailer,
      ...(existing?.sceneImages ?? []),
      ...(existing?.actorPhotos ?? []),
    ]) {
      if (path) protectedSources.add(path);
    }
  }
  const assets: DiscoveredAssets = { sceneImages: [], actorPhotos: [] };
  const within = (directory: string, filePath: string): string | undefined => {
    const name = relative(directory, filePath);
    return name &&
      name !== ".." &&
      !name.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(name)
      ? name
      : undefined;
  };
  const groups = [
    { key: "thumb" as const, paths: [downloaded.thumb ?? existing?.thumb], old: [existing?.thumb] },
    { key: "poster" as const, paths: [downloaded.poster ?? existing?.poster], old: [existing?.poster] },
    { key: "fanart" as const, paths: [downloaded.fanart ?? existing?.fanart], old: [existing?.fanart] },
    {
      key: "trailer" as const,
      paths: [
        input.assetDecisions?.trailer === "replace" ? downloaded.trailer : (downloaded.trailer ?? existing?.trailer),
      ],
      old: [existing?.trailer],
    },
    {
      key: "sceneImages" as const,
      paths: downloaded.sceneImages.length ? downloaded.sceneImages : (existing?.sceneImages ?? []),
      old: existing?.sceneImages ?? [],
    },
    {
      key: "actorPhotos" as const,
      paths: input.actorPhotoPaths.length ? input.actorPhotoPaths : (existing?.actorPhotos ?? []),
      old: existing?.actorPhotos ?? [],
    },
  ];
  for (const group of groups) {
    const targets: string[] = [];
    for (const sourcePath of group.paths) {
      if (!sourcePath) continue;
      let targetPath = mapped.get(sourcePath);
      if (!targetPath) {
        const stagedName = input.stagingDir ? within(input.stagingDir, sourcePath) : undefined;
        const existingName = within(input.existingAssetDir, sourcePath);
        const collection = group.key === "sceneImages" || group.key === "actorPhotos";
        const targetName =
          !collection && assetFileNames
            ? `${parse(assetFileNames[sourcePath === (downloaded.poster ?? existing?.poster) ? "poster" : group.key]).name}${parse(sourcePath).ext}`
            : undefined;
        targetPath =
          !organizeFiles && !stagedName
            ? sourcePath
            : join(
                input.metadataOutputDir,
                targetName ??
                  stagedName ??
                  existingName ??
                  (collection ? join(basename(dirname(sourcePath)), basename(sourcePath)) : basename(sourcePath)),
              );
        if (stagedName) {
          artifacts.push({
            targetPath,
            content: { kind: "file", path: sourcePath, size: (await stat(sourcePath)).size },
          });
        } else if (sourcePath !== targetPath) {
          sidecars.push({
            sourcePath,
            targetPath,
            size: (await stat(sourcePath)).size,
            preserveSource: protectedSources.has(sourcePath),
          });
        }
        mapped.set(sourcePath, targetPath);
      }
      targets.push(targetPath);
    }
    if (group.key === "sceneImages" || group.key === "actorPhotos") assets[group.key] = [...new Set(targets)];
    else assets[group.key] = targets[0];
    if (
      group.paths.some((source) => source && !group.old.includes(source)) ||
      (group.key === "trailer" && input.assetDecisions?.trailer === "replace")
    ) {
      for (const old of group.old) if (old && !targets.includes(old)) obsolete.add(old);
    }
  }
  let nfoPath =
    input.reuseNfo && input.organizePlan
      ? getNfoWritePaths(input.organizePlan.nfoPath, input.nfoNaming).canonicalPath
      : await input.writeNfo(
          { ...assets, downloaded: [...new Set(artifacts.map(({ targetPath }) => targetPath))] },
          async (targetPath, data) => {
            artifacts.push({ targetPath, content: { kind: "text", data } });
          },
        );
  if (!nfoPath && input.existingNfoPath) {
    const paths = getNfoWritePaths(input.organizePlan?.nfoPath ?? input.existingNfoPath, input.nfoNaming);
    nfoPath = paths.canonicalPath;
    let content = await readFile(input.existingNfoPath, "utf-8");
    if (organizeFiles && [...mapped].some(([source, target]) => source !== target)) {
      const xmlOptions = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false };
      const document = new XMLParser(xmlOptions).parse(content);
      let referencesChanged = false;
      const rewriteReferences = (nodes: Record<string, unknown>[], asset = false): void => {
        for (const node of nodes) {
          for (const [key, value] of Object.entries(node)) {
            if (key === "#text" && asset && typeof value === "string") {
              const target = mapped.get(resolve(input.existingAssetDir, value));
              if (target) {
                const reference = relative(input.metadataOutputDir, target).replaceAll("\\", "/");
                if (reference !== value) {
                  node[key] = reference;
                  referencesChanged = true;
                }
              }
            } else if (Array.isArray(value)) {
              rewriteReferences(value, asset || ["thumb", "poster", "fanart", "trailer"].includes(key));
            }
          }
        }
      };
      rewriteReferences(document);
      if (referencesChanged) content = new XMLBuilder(xmlOptions).build(document);
    }
    for (const targetPath of paths.requiredPaths) {
      artifacts.push({ targetPath, content: { kind: "text", data: content } });
    }
  }
  if (input.existingNfoPath && nfoPath && input.existingNfoPath !== nfoPath) obsolete.add(input.existingNfoPath);
  if (input.organizePlan && nfoPath) {
    for (const path of getNfoWritePaths(input.organizePlan.nfoPath, input.nfoNaming).stalePaths) obsolete.add(path);
    if (input.existingNfoPath && dirname(input.existingNfoPath) !== input.metadataOutputDir) {
      obsolete.add(join(dirname(input.existingNfoPath), "movie.nfo"));
    }
  }
  if (input.organizePlan?.strmPath) {
    artifacts.push({
      targetPath: input.organizePlan.strmPath,
      content: { kind: "text", data: await prepareStrmMirrorContent(input.sourceVideoPath, input.outputVideoPath) },
    });
    if (input.existingStrmPath && input.existingStrmPath !== input.organizePlan.strmPath)
      obsolete.add(input.existingStrmPath);
  }
  if (input.organizePlan && organizeFiles) {
    for (const sidecar of input.organizePlan.subtitleSidecars ?? []) {
      sidecars.push({
        sourcePath: sidecar.path,
        targetPath: buildSubtitleSidecarTargetPath(sidecar, input.outputVideoPath),
        size: (await stat(sidecar.path)).size,
      });
    }
    for (const sidecar of await findGeneratedVideoSidecars(input.sourceVideoPath)) {
      sidecars.push({
        sourcePath: sidecar.path,
        targetPath: buildGeneratedVideoSidecarTargetPath(
          sidecar,
          dirname(input.outputVideoPath),
          parse(input.organizePlan.nfoPath).name,
        ),
        size: (await stat(sidecar.path)).size,
        shared: true,
      });
    }
  }
  const assetRefs: PreparedPublicationPlan["assets"] = [];
  for (const kind of ["thumb", "poster", "fanart", "trailer"] as const) {
    const targetPath = assets[kind];
    const url = input.remoteData?.[`${kind}_source_url`] ?? input.remoteData?.[`${kind}_url`];
    if (targetPath) assetRefs.push({ kind, targetPath });
    else if (url?.trim()) assetRefs.push({ kind, url });
  }
  assetRefs.push(...assets.sceneImages.map((targetPath) => ({ kind: "scene", targetPath })));
  assetRefs.push(...assets.actorPhotos.map((targetPath) => ({ kind: "actor", targetPath })));
  if (!assets.sceneImages.length)
    assetRefs.push(...(input.remoteData?.scene_images ?? []).map((url) => ({ kind: "scene", url })));
  const retained = new Set([
    input.outputVideoPath,
    nfoPath,
    ...artifacts.map((artifact) => artifact.targetPath),
    ...sidecars.map((move) => move.targetPath),
  ]);
  return {
    assets,
    nfoPath,
    plan: {
      videos:
        input.organizePlan && organizeFiles
          ? [
              {
                sourcePath: input.sourceVideoPath,
                targetPath: input.outputVideoPath,
                size: (await stat(input.sourceVideoPath)).size,
                content: await prepareMovedStrmContent(input.sourceVideoPath, input.outputVideoPath),
              },
            ]
          : [],
      sidecars,
      artifacts,
      assets: assetRefs,
      obsoletePaths: [...obsolete].filter((filePath) => !retained.has(filePath) && !protectedSources.has(filePath)),
      replaceExistingTargetPaths: [
        ...new Set([...artifacts.map(({ targetPath }) => targetPath), ...sidecars.map(({ targetPath }) => targetPath)]),
      ],
    },
  };
};
