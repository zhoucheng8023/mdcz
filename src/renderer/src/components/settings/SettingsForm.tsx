import { useEffect, useMemo, useRef } from "react";
import type { FieldValues } from "react-hook-form";
import { useForm } from "react-hook-form";
import { SiteConfigSection } from "@/components/config-form/SiteConfigSection";
import { SectionAnchor } from "./SectionAnchor";
import { Subsection } from "./Subsection";
import {
  AssetDownloadsSection,
  BehaviorSection,
  EmbySection,
  Form,
  flattenConfig,
  JellyfinSection,
  NamingSection,
  NetworkConnectionSection,
  NetworkCookiesSection,
  NfoSection,
  PathsSection,
  PersonSyncSharedSection,
  ScrapePacingSection,
  ScrapeSitesSection,
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  ShortcutsSection,
  TranslateSection,
  UiSection,
  useCrawlerSiteOptions,
} from "./settingsContent";

interface SettingsFormProps {
  data: Record<string, unknown>;
}

export function SettingsForm({ data }: SettingsFormProps) {
  const flatDefaults = useMemo(() => flattenConfig(data), [data]);
  const initialUseCustomTitleBarRef = useRef<boolean | null>(null);

  if (initialUseCustomTitleBarRef.current === null) {
    initialUseCustomTitleBarRef.current = Boolean(flatDefaults["ui.useCustomTitleBar"] ?? true);
  }

  const form = useForm<FieldValues>({
    defaultValues: flatDefaults,
    mode: "onChange",
  });

  useEffect(() => {
    form.reset(flatDefaults);
  }, [flatDefaults, form]);

  const siteOptions = useCrawlerSiteOptions(flatDefaults);
  const initialUseCustomTitleBar = initialUseCustomTitleBarRef.current ?? true;

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="space-y-16"
      >
        <SectionAnchor
          id="dataSources"
          label={SECTION_LABELS.dataSources}
          title={SECTION_LABELS.dataSources}
          description={SECTION_DESCRIPTIONS.dataSources}
        >
          <Subsection title="刮削站点" description="启用网站、优先级、每站 URL 与站点凭证">
            <ScrapeSitesSection siteOptions={siteOptions} />
            <SiteConfigSection />
            <NetworkCookiesSection />
          </Subsection>
          <Subsection title="翻译">
            <TranslateSection />
          </Subsection>
          <Subsection title="人物同步 · Jellyfin" description="共享的来源顺序 + Jellyfin 连接">
            <PersonSyncSharedSection />
            <JellyfinSection />
          </Subsection>
          <Subsection title="人物同步 · Emby">
            <EmbySection />
          </Subsection>
        </SectionAnchor>

        <SectionAnchor
          id="rateLimiting"
          label={SECTION_LABELS.rateLimiting}
          title={SECTION_LABELS.rateLimiting}
          description={SECTION_DESCRIPTIONS.rateLimiting}
        >
          <Subsection title="刮削节奏">
            <ScrapePacingSection />
          </Subsection>
          <Subsection title="网络">
            <NetworkConnectionSection />
          </Subsection>
        </SectionAnchor>

        <SectionAnchor
          id="extractionRules"
          label={SECTION_LABELS.extractionRules}
          title={SECTION_LABELS.extractionRules}
          description={SECTION_DESCRIPTIONS.extractionRules}
        >
          <Subsection title="命名模板">
            <NamingSection />
          </Subsection>
          <Subsection title="资源下载">
            <AssetDownloadsSection />
          </Subsection>
          <Subsection title="NFO">
            <NfoSection />
          </Subsection>
        </SectionAnchor>

        <SectionAnchor
          id="paths"
          label={SECTION_LABELS.paths}
          title={SECTION_LABELS.paths}
          description={SECTION_DESCRIPTIONS.paths}
        >
          <PathsSection />
        </SectionAnchor>

        <SectionAnchor
          id="system"
          label={SECTION_LABELS.system}
          title={SECTION_LABELS.system}
          description={SECTION_DESCRIPTIONS.system}
        >
          <Subsection title="界面">
            <UiSection initialUseCustomTitleBar={initialUseCustomTitleBar} />
          </Subsection>
          <Subsection title="快捷键">
            <ShortcutsSection />
          </Subsection>
          <Subsection title="文件行为">
            <BehaviorSection />
          </Subsection>
        </SectionAnchor>
      </form>
    </Form>
  );
}
