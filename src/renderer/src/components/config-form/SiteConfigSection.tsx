import type { Website } from "@shared/enums";
import { useQuery } from "@tanstack/react-query";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { BaseField } from "./FieldRenderer";

interface SiteInfo {
  site: Website;
  name: string;
  enabled: boolean;
  native: boolean;
}

export function SiteConfigSection() {
  const form = useFormContext<FieldValues>();
  const sites =
    (useWatch({
      control: form.control,
      name: "scrape.sites",
    }) as Website[] | undefined) ?? [];

  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as { sites: SiteInfo[] };
      return result.sites;
    },
    staleTime: 60_000,
  });

  const visibleSites = [...new Set(sites)];
  const siteInfoMap = new Map((sitesQ.data ?? []).map((site) => [site.site, site]));

  if (visibleSites.length === 0) return null;

  return (
    <div className="space-y-1">
      {visibleSites.map((site) => {
        const urlKey = `scrape.siteConfigs.${site}.customUrl`;
        const siteInfo = siteInfoMap.get(site);

        return (
          <BaseField key={site} name={urlKey} label={siteInfo?.name ?? site} commitMode="debounce">
            {(field) => (
              <FormControl>
                <Input
                  {...field}
                  value={(field.value as string) ?? ""}
                  placeholder="默认 URL（留空使用内置地址）"
                  className="h-8 w-[320px] text-sm bg-background/50 focus:bg-background transition-all"
                />
              </FormControl>
            )}
          </BaseField>
        );
      })}
    </div>
  );
}
