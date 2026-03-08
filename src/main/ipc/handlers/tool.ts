import type { ServiceContainer } from "@main/container";
import { configManager, configurationSchema } from "@main/services/config";
import { checkConnection, JellyfinServiceError, parseMode } from "@main/services/jellyfin";
import { loggerService } from "@main/services/LoggerService";
import { SymlinkServiceError } from "@main/services/tools";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");

export const createToolHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Tool_ServerCheckConnection
  | typeof IpcChannel.Tool_ActorPhotoSync
  | typeof IpcChannel.Tool_ActorInfoSync
  | typeof IpcChannel.Tool_CreateSymlink
  | typeof IpcChannel.Tool_ToggleDevTools
> => {
  const { networkClient, actorPhotoService, actorInfoService, symlinkService, windowService } = context;
  let symlinkTask: Promise<void> | null = null;

  const ensureServerReady = async () => {
    await configManager.ensureLoaded();
    const configuration = configurationSchema.parse(await configManager.get());

    if (!configuration.server.url.trim() || !configuration.server.apiKey.trim()) {
      throw createIpcError(IpcErrorCode.NETWORK_ERROR, "Server URL and API key are required");
    }

    return configuration;
  };

  return {
    [IpcChannel.Tool_ServerCheckConnection]: t.procedure.action(async () => {
      try {
        const configuration = await ensureServerReady();
        return await checkConnection(networkClient, configuration);
      } catch (error) {
        if (error instanceof JellyfinServiceError) {
          throw createIpcError(error.code, error.message);
        }
        logger.error(`Tool_ServerCheckConnection failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Tool_ActorPhotoSync]: t.procedure.input<{ mode?: "all" | "missing" }>().action(async ({ input }) => {
      try {
        const mode = parseMode(input?.mode);
        if (!mode) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");
        }
        const configuration = await ensureServerReady();
        return actorPhotoService.run(configuration, mode);
      } catch (error) {
        if (error instanceof JellyfinServiceError) {
          throw createIpcError(error.code, error.message);
        }
        logger.error(`Tool_ActorPhotoSync failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Tool_ActorInfoSync]: t.procedure.input<{ mode?: "all" | "missing" }>().action(async ({ input }) => {
      try {
        const mode = parseMode(input?.mode);
        if (!mode) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");
        }
        const configuration = await ensureServerReady();
        return actorInfoService.run(configuration, mode);
      } catch (error) {
        if (error instanceof JellyfinServiceError) {
          throw createIpcError(error.code, error.message);
        }
        logger.error(`Tool_ActorInfoSync failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Tool_CreateSymlink]: t.procedure
      .input<{
        sourceDir?: string;
        source_dir?: string;
        destDir?: string;
        dest_dir?: string;
        copyFiles?: boolean;
        copy_files?: boolean;
      }>()
      .action(async ({ input }): Promise<{ message: string }> => {
        try {
          if (symlinkTask) {
            throw createIpcError(IpcErrorCode.OPERATION_CANCELLED, "Softlink creation task is already running");
          }

          const sourceDir = (input?.sourceDir ?? input?.source_dir ?? "").trim();
          const destDir = (input?.destDir ?? input?.dest_dir ?? "").trim();
          const copyFiles = input?.copyFiles ?? input?.copy_files ?? false;

          if (!sourceDir || !destDir) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Source and destination directories are required");
          }

          symlinkTask = symlinkService
            .run({ sourceDir, destDir, copyFiles })
            .then(() => undefined)
            .catch((error) => {
              logger.error(`Tool_CreateSymlink failed: ${toErrorMessage(error)}`);
            })
            .finally(() => {
              symlinkTask = null;
            });

          return { message: "Softlink creation task started. Check logs for progress." };
        } catch (error) {
          if (error instanceof SymlinkServiceError) {
            throw createIpcError(error.code, error.message);
          }
          logger.error(`Tool_CreateSymlink setup failed: ${toErrorMessage(error)}`);
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.Tool_ToggleDevTools]: t.procedure.action(async () => {
      windowService.toggleDevTools();
      return { success: true as const };
    }),
  };
};
