import { observePublicationFile } from "./preflight";
import type { PublicationFileSystem } from "./types";

export const restorePublicationFile = async (
  fileSystem: PublicationFileSystem,
  item: {
    sourcePath?: string;
    targetPath: string;
    temporaryPath: string;
    backupPath: string | null;
    targetExisted: boolean;
  },
  restoreTarget = true,
): Promise<void> => {
  const backupExists = item.backupPath ? (await observePublicationFile(fileSystem, item.backupPath)).exists : false;
  if (item.sourcePath && !(await observePublicationFile(fileSystem, item.sourcePath)).exists) {
    const temporaryExists = (await observePublicationFile(fileSystem, item.temporaryPath)).exists;
    const recoverableTarget = restoreTarget && (!item.targetExisted || backupExists);
    if (!temporaryExists && !recoverableTarget) {
      throw new Error(`Pending publication is missing its source: ${item.sourcePath}`);
    }
    // Restore the only copy before replacing or deleting any publication target.
    await fileSystem.rename(temporaryExists ? item.temporaryPath : item.targetPath, item.sourcePath);
  }
  if (!restoreTarget) return;
  if (backupExists && item.backupPath) {
    await fileSystem.rename(item.backupPath, item.targetPath);
  } else if (item.targetExisted) {
    if (!(await observePublicationFile(fileSystem, item.targetPath)).exists) {
      throw new Error(`Pending publication is missing both backup and target: ${item.targetPath}`);
    }
  } else {
    await fileSystem.rm(item.targetPath, { force: true });
  }
};
