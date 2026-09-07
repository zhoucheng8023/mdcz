import type { SubtitleSidecarMatch } from "../media";
import type { SidecarResolver } from "./SidecarResolver";

export class PathPlanner {
  constructor(private readonly sidecarResolver: SidecarResolver) {}

  async resolveBundledTargetPaths(options: {
    sourceVideoPath: string;
    targetVideoPath: string;
    nfoPath?: string;
    subtitleSidecars?: SubtitleSidecarMatch[];
  }): Promise<{ targetVideoPath: string; nfoPath?: string; subtitleSidecars: SubtitleSidecarMatch[] }> {
    return {
      targetVideoPath: options.targetVideoPath,
      nfoPath: options.nfoPath,
      subtitleSidecars: await this.sidecarResolver.resolveSubtitleSidecars(
        options.sourceVideoPath,
        options.subtitleSidecars,
      ),
    };
  }
}
