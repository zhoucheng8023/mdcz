import { type ReactNode, useRef } from "react";
import { FloatingToc } from "./FloatingToc";
import { ProfileCapsule } from "./ProfileCapsule";
import { SettingsSearch } from "./SettingsSearch";
import { TocProvider } from "./TocContext";

interface SettingsLayoutProps {
  searchDisabled?: boolean;
  profiles: string[];
  activeProfile: string | null;
  profileLoading?: boolean;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  onExportProfile: () => void;
  onImportProfile: () => void;
  children: ReactNode;
}

export function SettingsLayout({
  searchDisabled = false,
  profiles,
  activeProfile,
  profileLoading = false,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  onExportProfile,
  onImportProfile,
  children,
}: SettingsLayoutProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <TocProvider scrollContainerRef={scrollContainerRef}>
      <div className="flex h-full flex-col bg-surface-canvas">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto flex max-w-6xl gap-6 px-6 pb-24 pt-10 md:px-10">
            <div className="min-w-0 flex-1">
              <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-end">
                <div className="flex items-center gap-2.5">
                  <SettingsSearch disabled={searchDisabled} />
                  <ProfileCapsule
                    profiles={profiles}
                    activeProfile={activeProfile}
                    isLoading={profileLoading}
                    onSwitchProfile={onSwitchProfile}
                    onCreateProfile={onCreateProfile}
                    onDeleteProfile={onDeleteProfile}
                    onResetConfig={onResetConfig}
                    onExportProfile={onExportProfile}
                    onImportProfile={onImportProfile}
                  />
                </div>
              </header>
              <div className="mt-6">{children}</div>
            </div>
            <FloatingToc />
          </div>
        </div>
      </div>
    </TocProvider>
  );
}
