import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import { FloatingToc } from "./FloatingToc";
import { ProfileCapsule } from "./ProfileCapsule";
import { SettingsSearch } from "./SettingsSearch";
import { TocProvider } from "./TocContext";

interface SettingsLayoutProps {
  title: string;
  subtitle?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  profiles: string[];
  activeProfile: string;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  configPath?: string;
  children: ReactNode;
}

export function SettingsLayout({
  title,
  subtitle,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  profiles,
  activeProfile,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  configPath,
  children,
}: SettingsLayoutProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <TocProvider scrollContainerRef={scrollContainerRef}>
      <div className="flex h-full flex-col bg-surface-canvas">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto flex max-w-6xl gap-6 px-6 pb-24 pt-10 md:px-10">
            <div className="min-w-0 flex-1">
              <SettingsHeader
                title={title}
                subtitle={subtitle}
                searchValue={searchValue}
                onSearchChange={onSearchChange}
                onSearchSubmit={onSearchSubmit}
                profiles={profiles}
                activeProfile={activeProfile}
                onSwitchProfile={onSwitchProfile}
                onCreateProfile={onCreateProfile}
                onDeleteProfile={onDeleteProfile}
                onResetConfig={onResetConfig}
                configPath={configPath}
              />
              <div className="mt-12 space-y-16">{children}</div>
            </div>
            <FloatingToc />
          </div>
        </div>
      </div>
    </TocProvider>
  );
}

interface SettingsHeaderProps extends Omit<SettingsLayoutProps, "children"> {}

function SettingsHeader({
  title,
  subtitle,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  profiles,
  activeProfile,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  configPath,
}: SettingsHeaderProps) {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className={cn("font-numeric text-4xl font-black tracking-tight text-foreground md:text-5xl")}>{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        {configPath && (
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70" title={configPath}>
            {configPath}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <SettingsSearch value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} />
        <ProfileCapsule
          profiles={profiles}
          activeProfile={activeProfile}
          onSwitchProfile={onSwitchProfile}
          onCreateProfile={onCreateProfile}
          onDeleteProfile={onDeleteProfile}
          onResetConfig={onResetConfig}
        />
      </div>
    </header>
  );
}
