import { type ReactNode, useEffect } from "react";
import { CrossFieldBanner } from "@/components/settings/CrossFieldBanner";
import { type FieldEntry, SECTION_LABELS } from "@/components/settings/settingsRegistry";
import { useCrossFieldErrors } from "@/hooks/useCrossFieldErrors";
import { cn } from "@/lib/utils";
import { useOptionalToc } from "./TocContext";

interface SectionAnchorProps {
  id: string;
  label: string;
  title?: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

function isKnownAnchor(id: string): id is FieldEntry["anchor"] {
  return id in SECTION_LABELS;
}

export function SectionAnchor({ id, label, title, description, className, children }: SectionAnchorProps) {
  const toc = useOptionalToc();

  useEffect(() => {
    if (!toc) return;
    return toc.register({ id, label });
  }, [toc, id, label]);

  return (
    <section data-toc-id={id} id={`settings-${id}`} className={cn("scroll-mt-28", className)}>
      {(title || description) && (
        <header className="mb-6">
          {title && (
            <h2 className="font-numeric text-3xl font-bold tracking-tight text-foreground md:text-4xl">{title}</h2>
          )}
          {description && <p className="mt-2 max-w-prose text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      {isKnownAnchor(id) && <SectionBanner sectionKey={id} />}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function SectionBanner({ sectionKey }: { sectionKey: FieldEntry["anchor"] }) {
  const errors = useCrossFieldErrors(sectionKey);
  return <CrossFieldBanner errors={errors} />;
}
