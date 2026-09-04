import { join } from "node:path";
import { FileTranslationMappingStore } from "@mdcz/runtime/translate";
import { app } from "electron";

const resolveBundledDirectory = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "mapping_table")
    : join(app.getAppPath(), "../../packages/runtime/resources/mapping_table");

export const translationMappingStore = new FileTranslationMappingStore(resolveBundledDirectory());
