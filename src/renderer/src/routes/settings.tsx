import { toErrorMessage } from "@shared/error";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { SettingsSearchProvider, useSettingsSearch } from "@/components/settings/SettingsSearchContext";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useCurrentConfig } from "@/hooks/useCurrentConfig";
import { useSettingsSavingStore } from "@/store/settingsSavingStore";

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
});

function SettingsComponent() {
  const queryClient = useQueryClient();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDialogOpen, setNewProfileDialogOpen] = useState(false);
  const [deleteProfileDialogOpen, setDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileName, setDeleteProfileName] = useState("");

  const configQ = useCurrentConfig({
    refetchOnWindowFocus: false,
  });

  const configInfoQ = useQuery({
    queryKey: ["config", "info"],
    queryFn: async () => ipc.config.list(),
    refetchOnWindowFocus: false,
  });

  const profilesQ = useQuery({
    queryKey: ["config", "profiles"],
    queryFn: async () => ipc.config.listProfiles(),
    refetchOnWindowFocus: false,
  });

  const handleReset = async () => {
    try {
      await ipc.config.reset();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast.success("已恢复默认设置");
      setResetDialogOpen(false);
    } catch (error) {
      toast.error(`重置失败: ${toErrorMessage(error)}`);
    }
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    try {
      await ipc.config.createProfile(name);
      queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
      toast.success(`配置档案 "${name}" 已创建`);
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    } catch (error) {
      toast.error(`创建失败: ${toErrorMessage(error)}`);
    }
  };

  const handleSwitchProfile = async (name: string) => {
    const inFlight = useSettingsSavingStore.getState().inFlight;
    if (inFlight > 0) {
      toast.warning("有配置正在自动保存，请稍候再切换档案");
      return;
    }
    try {
      await ipc.config.switchProfile(name);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
      queryClient.invalidateQueries({ queryKey: ["config", "info"] });
      toast.success(`已切换到配置档案 "${name}"`);
    } catch (error) {
      toast.error(`切换失败: ${toErrorMessage(error)}`);
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileName) return;
    try {
      await ipc.config.deleteProfile(deleteProfileName);
      queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
      toast.success("配置档案已删除");
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    } catch (error) {
      toast.error(`删除失败: ${toErrorMessage(error)}`);
    }
  };

  const profiles = profilesQ.data?.profiles ?? [];
  const activeProfile = profilesQ.data?.active ?? "";

  const deletableProfiles = useMemo(
    () => profiles.filter((profile) => profile !== activeProfile),
    [profiles, activeProfile],
  );

  useEffect(() => {
    if (!deleteProfileDialogOpen) {
      return;
    }
    if (!deleteProfileName || !deletableProfiles.includes(deleteProfileName)) {
      setDeleteProfileName(deletableProfiles[0] ?? "");
    }
  }, [deleteProfileDialogOpen, deleteProfileName, deletableProfiles]);

  if (configQ.isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (configQ.isError) {
    return <div className="p-4 text-destructive">Error loading settings.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {configQ.data && (
          <SettingsSearchProvider>
            <SettingsLayoutConnected
              profiles={profiles}
              activeProfile={activeProfile}
              configPath={configInfoQ.data?.configPath}
              onSwitchProfile={handleSwitchProfile}
              onCreateProfile={() => setNewProfileDialogOpen(true)}
              onDeleteProfile={() => setDeleteProfileDialogOpen(true)}
              onResetConfig={() => setResetDialogOpen(true)}
            >
              <SettingsForm key={activeProfile || "default"} data={configQ.data} />
            </SettingsLayoutConnected>
          </SettingsSearchProvider>
        )}
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复默认设置</DialogTitle>
            <DialogDescription>确定要将所有设置恢复为默认值吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleReset}>
              确定恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New profile dialog */}
      <Dialog open={newProfileDialogOpen} onOpenChange={setNewProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建配置档案</DialogTitle>
            <DialogDescription>输入新配置档案的名称，将以默认设置创建。</DialogDescription>
          </DialogHeader>
          <Input
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="配置档案名称"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateProfile();
            }}
          />
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleCreateProfile} disabled={!newProfileName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete profile dialog */}
      <Dialog open={deleteProfileDialogOpen} onOpenChange={setDeleteProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除配置档案</DialogTitle>
            <DialogDescription>选择要删除的配置档案（当前档案不可删除）。</DialogDescription>
          </DialogHeader>
          <Select value={deleteProfileName} onValueChange={setDeleteProfileName}>
            <SelectTrigger>
              <SelectValue placeholder="选择配置档案" />
            </SelectTrigger>
            <SelectContent>
              {deletableProfiles.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {profile}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDeleteProfile} disabled={!deleteProfileName}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SettingsLayoutConnectedProps {
  profiles: string[];
  activeProfile: string;
  configPath?: string;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  children: React.ReactNode;
}

/**
 * Thin connector between the settings search context and SettingsLayout so
 * Enter on the outer search input jumps to the first match and re-renders
 * only the layout + search provider tree.
 */
function SettingsLayoutConnected({
  profiles,
  activeProfile,
  configPath,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  children,
}: SettingsLayoutConnectedProps) {
  const { query, setQuery, focusFirstMatch } = useSettingsSearch();

  return (
    <SettingsLayout
      title="刮削设置"
      subtitle="管理媒体库、刮削策略及系统偏好"
      searchValue={query}
      onSearchChange={setQuery}
      onSearchSubmit={focusFirstMatch}
      profiles={profiles}
      activeProfile={activeProfile}
      onSwitchProfile={onSwitchProfile}
      onCreateProfile={onCreateProfile}
      onDeleteProfile={onDeleteProfile}
      onResetConfig={onResetConfig}
      configPath={configPath}
    >
      {children}
    </SettingsLayout>
  );
}
