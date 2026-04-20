export const SUPPORTED_MEDIA_EXTENSIONS = [
  "mp4",
  "avi",
  "rmvb",
  "wmv",
  "mov",
  "mkv",
  "flv",
  "ts",
  "webm",
  "iso",
  "mpg",
  "strm",
] as const;

export type SupportedMediaExtension = (typeof SUPPORTED_MEDIA_EXTENSIONS)[number];

export const SUPPORTED_MEDIA_EXTENSIONS_WITH_DOT = SUPPORTED_MEDIA_EXTENSIONS.map((extension) => `.${extension}`);
