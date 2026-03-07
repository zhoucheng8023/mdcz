import { open, stat } from "node:fs/promises";
import { isTrackType } from "mediainfo.js";
import { CHUNK_SIZE, getMediaInfo, toNumber } from "./video";

export interface ImageValidation {
  valid: boolean;
  width: number;
  height: number;
  reason?: "file_too_small" | "parse_failed";
}

export async function validateImage(filePath: string, minBytes = 8192): Promise<ImageValidation> {
  const fileStat = await stat(filePath);
  if (fileStat.size < minBytes) {
    return {
      valid: false,
      width: 0,
      height: 0,
      reason: "file_too_small",
    };
  }

  const mediaInfo = await getMediaInfo();
  const handle = await open(filePath, "r");

  try {
    const metadata = await mediaInfo.analyzeData(
      () => fileStat.size,
      async (chunkSize, offset) => {
        const remaining = Math.max(0, fileStat.size - offset);
        if (remaining === 0) {
          return new Uint8Array(0);
        }

        const requestedSize = chunkSize > 0 ? chunkSize : CHUNK_SIZE;
        const length = Math.min(requestedSize, remaining);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      },
    );

    const tracks = metadata.media?.track ?? [];
    const track =
      tracks.find((item) => isTrackType(item, "Image")) ?? tracks.find((item) => isTrackType(item, "Video"));
    const width = Math.max(0, Math.round(toNumber(track?.Width)));
    const height = Math.max(0, Math.round(toNumber(track?.Height)));

    if (width <= 0 || height <= 0) {
      return {
        valid: false,
        width,
        height,
        reason: "parse_failed",
      };
    }

    return {
      valid: true,
      width,
      height,
    };
  } catch {
    return {
      valid: false,
      width: 0,
      height: 0,
      reason: "parse_failed",
    };
  } finally {
    await handle.close();
  }
}
