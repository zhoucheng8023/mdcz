import { basename, dirname, extname, join } from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { remapNfoAssetPaths } from "../scrape/nfo";
import { replaceStrmTarget } from "../scrape/utils/strm";
import type { PublicationPlan, PublicationVideo } from "./types";

const key = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

export const planVideoTargetChanges = (video: PublicationVideo, nextVideo: RootFileRef) => {
  const oldName = basename(video.target.relativePath, extname(video.target.relativePath));
  const nextName = basename(nextVideo.relativePath, extname(nextVideo.relativePath));
  return [
    { from: { ...video.target }, to: nextVideo },
    ...(video.nameTargets ?? []).map((target) => ({
      from: { ...target },
      to: {
        rootId: target.rootId,
        relativePath: join(
          dirname(target.relativePath),
          nextName + basename(target.relativePath).slice(oldName.length),
        ).replaceAll("\\", "/"),
      },
    })),
  ];
};

export const retargetPublicationVideo = (
  plan: PublicationPlan,
  video: PublicationVideo,
  changes: ReturnType<typeof planVideoTargetChanges>,
  resolve: (ref: RootFileRef) => string,
): void => {
  const mapping = new Map(changes.map(({ from, to }) => [key(from), to]));
  const paths = new Map(
    changes.flatMap(
      ({ from, to }) =>
        [
          [resolve(from), resolve(to)],
          [basename(from.relativePath), basename(to.relativePath)],
        ] as Array<[string, string]>,
    ),
  );
  const mirrors = new Set((video.referenceTargets ?? []).map(key));
  const artifacts = plan.artifacts.map((artifact) => {
    let content = artifact.content;
    if (mirrors.has(key(artifact.target)) && content.kind === "text") {
      content = { kind: "text", data: replaceStrmTarget(content.data, resolve(changes[0].to)) };
    } else if (extname(artifact.target.relativePath).toLowerCase() === ".nfo" && content.kind !== "download") {
      content = { kind: "text", data: remapNfoAssetPaths(content.data.toString(), paths) };
    }
    return { target: mapping.get(key(artifact.target)) ?? artifact.target, content };
  });
  for (const move of [...(plan.videos ?? []), ...(plan.sidecars ?? [])])
    move.target = mapping.get(key(move.target)) ?? move.target;
  for (const asset of plan.assets) {
    if (asset.type === "local") asset.file = mapping.get(key(asset.file)) ?? asset.file;
  }
  plan.artifacts = artifacts;
  video.nameTargets = video.nameTargets?.map((ref) => mapping.get(key(ref)) ?? ref);
  video.referenceTargets = video.referenceTargets?.map((ref) => mapping.get(key(ref)) ?? ref);
  plan.replaceExistingTargets = plan.replaceExistingTargets?.filter((ref) => !mapping.has(key(ref)));
  // Keep the old video's companions when allocating another version in the same directory.
  plan.obsolete = plan.obsolete.filter((ref) => !mapping.has(key(ref)));
  plan.targetChanges = [...(plan.targetChanges ?? []), ...changes];
};
