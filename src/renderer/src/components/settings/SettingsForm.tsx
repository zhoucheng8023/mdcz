import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { FieldValues } from "react-hook-form";
import { useForm } from "react-hook-form";
import { SiteConfigSection } from "@/components/config-form/SiteConfigSection";
import { Button } from "@/components/ui/Button";
import { SectionAnchor } from "./SectionAnchor";
import { Subsection } from "./Subsection";
import {
  AssetDownloadsSection,
  BehaviorSection,
  EmbySection,
  FIELD_REGISTRY,
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
  unflattenConfig,
  useCrawlerSiteOptions,
} from "./settingsContent";

interface SettingsFormProps {
  data: Record<string, unknown>;
  onSubmit: (data: FieldValues) => Promise<unknown> | unknown;
  serverErrors?: string[];
  serverFieldErrors?: Record<string, string>;
  onDirtyChange?: (dirty: boolean) => void;
}

export interface SettingsFormHandle {
  submit: () => Promise<boolean>;
}

export const SettingsForm = forwardRef<SettingsFormHandle, SettingsFormProps>(function SettingsForm(
  { data, onSubmit, serverErrors, serverFieldErrors, onDirtyChange },
  ref,
) {
  const flatDefaults = useMemo(() => flattenConfig(data), [data]);
  const initialUseCustomTitleBarRef = useRef<boolean | null>(null);
  const submitPromiseRef = useRef<Promise<boolean> | null>(null);

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

  const handleFormSubmit = useCallback(
    async (values: FieldValues) => {
      await onSubmit(unflattenConfig(values));
      form.reset(values);
      onDirtyChange?.(false);
    },
    [form, onDirtyChange, onSubmit],
  );

  const submit = useCallback(async () => {
    if (submitPromiseRef.current) {
      return submitPromiseRef.current;
    }

    const submission = (async () => {
      let ok = false;
      await form.handleSubmit(
        async (values) => {
          try {
            await handleFormSubmit(values);
            ok = true;
          } catch {
            ok = false;
          }
        },
        () => {
          ok = false;
        },
      )();
      return ok;
    })();

    submitPromiseRef.current = submission.finally(() => {
      submitPromiseRef.current = null;
    });

    return submitPromiseRef.current;
  }, [form, handleFormSubmit]);

  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const isDirty = form.formState.isDirty;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!serverErrors?.length) return;
    for (const fieldPath of serverErrors) {
      form.setError(fieldPath, {
        type: "server",
        message: serverFieldErrors?.[fieldPath] ?? "校验失败",
      });
    }
    const firstError = serverErrors[0];
    if (firstError) {
      const entry = FIELD_REGISTRY.find((f) => f.key === firstError);
      if (entry) {
        const el = document.querySelector<HTMLElement>(`[data-toc-id="${entry.anchor}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [serverErrors, serverFieldErrors, form]);

  const initialUseCustomTitleBar = initialUseCustomTitleBarRef.current ?? true;
  const isSaveDisabled = !isDirty || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-16"
      >
        <div className="flex justify-end">
          <Button
            type="submit"
            className="rounded-[var(--radius-quiet-sm)] h-9 px-6 text-xs font-semibold shadow-sm"
            disabled={isSaveDisabled}
          >
            {form.formState.isSubmitting ? "保存中..." : "保存设置"}
          </Button>
        </div>

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
});
