import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUserDataPath = "";

vi.mock("electron", () => {
  return {
    app: {
      isReady: () => false,
      isPackaged: false,
      getAppPath: () => "/tmp/app",
      getPath: (name: string) => {
        if (name === "userData") {
          return mockUserDataPath;
        }
        throw new Error(`Unsupported app path: ${name}`);
      },
      commandLine: {
        appendSwitch: () => {},
      },
      setAppUserModelId: () => {},
    },
  };
});

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
};

describe("ConfigManager configDirectory", () => {
  beforeEach(async () => {
    mockUserDataPath = await mkdtemp(join(tmpdir(), "config-manager-"));
    await mkdir(mockUserDataPath, { recursive: true });
    vi.resetModules();
  });

  it("applies paths.configDirectory immediately and keeps it after reload", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    await manager.save({
      paths: {
        configDirectory: "custom-config",
      },
    });

    const expectedConfigPath = join(mockUserDataPath, "custom-config", "default.json");
    const expectedMetaPath = join(mockUserDataPath, ".config-directory.json");

    expect(await fileExists(expectedConfigPath)).toBe(true);
    expect(await fileExists(expectedMetaPath)).toBe(true);

    const reloaded = new ConfigManager();
    const configuration = (await reloaded.get()) as { paths: { configDirectory: string } };
    expect(configuration.paths.configDirectory).toBe("custom-config");
    expect(reloaded.list().dataDir).toBe(join(mockUserDataPath, "custom-config"));
  });

  it("creates, switches, and deletes profiles in the active config directory", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    await manager.createProfile("windows-dev");

    expect(await fileExists(join(mockUserDataPath, "config", "windows-dev.json"))).toBe(true);

    const createdProfiles = await manager.listProfiles();
    expect(createdProfiles.profiles).toEqual(expect.arrayContaining(["default", "windows-dev"]));
    expect(createdProfiles.active).toBe("default");

    await manager.switchProfile("windows-dev");

    const switchedProfiles = await manager.listProfiles();
    expect(switchedProfiles.active).toBe("windows-dev");
    expect(manager.list().configPath).toBe(join(mockUserDataPath, "config", "windows-dev.json"));

    await expect(manager.deleteProfile("windows-dev")).rejects.toThrow("Cannot delete the active profile");

    await manager.switchProfile("default");
    await manager.deleteProfile("windows-dev");

    const deletedProfiles = await manager.listProfiles();
    expect(deletedProfiles.profiles).toEqual(["default"]);
    expect(await fileExists(join(mockUserDataPath, "config", "windows-dev.json"))).toBe(false);
  });
});
