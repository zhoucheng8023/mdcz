import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { useResolvedImageSrc } from "@/hooks/useResolvedImageSources";

interface SceneImageGalleryProps {
  images: string[];
  maxThumbnails?: number;
  baseDir?: string;
  label?: string;
  variant?: "compact" | "filmstrip";
}

export function SceneImageGallery({
  images,
  maxThumbnails = 10,
  baseDir,
  label = "场景预览",
  variant = "compact",
}: SceneImageGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const isOpen = lightboxIndex >= 0;

  const visibleThumbnails = images.slice(0, maxThumbnails);
  const remainingCount = images.length - maxThumbnails;
  const isFilmstrip = variant === "filmstrip";

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = useCallback(() => setLightboxIndex(-1), []);

  const goPrev = useCallback(() => {
    setLightboxIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    setLightboxIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  }, [images.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goPrev, goNext, closeLightbox]);

  if (images.length === 0) return null;

  return (
    <div>
      <div
        className={
          isFilmstrip
            ? "mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80"
            : "mb-2 text-xs text-muted-foreground"
        }
      >
        {label}
        {!isFilmstrip ? ` (${images.length})` : ""}
      </div>

      <div
        className={isFilmstrip ? "flex gap-4 overflow-x-auto pb-4" : "flex gap-1.5 overflow-x-auto p-1 scrollbar-thin"}
      >
        {visibleThumbnails.map((imagePath, index) => (
          <button
            key={imagePath}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openLightbox(index);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            className={
              isFilmstrip
                ? "relative h-[136px] w-[240px] shrink-0 overflow-hidden rounded-quiet border border-black/5 bg-surface-low/55 shadow-[0_10px_24px_rgba(0,0,0,0.06)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(0,0,0,0.08)]"
                : "h-14 w-20 shrink-0 cursor-pointer rounded-md border bg-muted/20 transition-all hover:ring-2 hover:ring-primary/50"
            }
          >
            <LazyImage src={imagePath} alt={`Scene ${index + 1}`} baseDir={baseDir} variant={variant} />
          </button>
        ))}
        {remainingCount > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openLightbox(maxThumbnails);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            className={
              isFilmstrip
                ? "flex h-[136px] w-[240px] shrink-0 items-center justify-center overflow-hidden rounded-quiet border border-dashed border-black/10 bg-surface-low/45 text-muted-foreground transition-colors hover:bg-surface-low/60"
                : "flex h-14 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-colors hover:bg-muted/50"
            }
          >
            <span
              className={
                isFilmstrip ? "text-sm font-semibold text-foreground/70" : "text-xs font-medium text-muted-foreground"
              }
            >
              +{remainingCount}
            </span>
          </button>
        )}
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) closeLightbox();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-[90vw] max-h-[90vh] p-0 border-0 bg-black/95 overflow-hidden"
        >
          <DialogTitle className="sr-only">场景图预览</DialogTitle>
          <DialogDescription className="sr-only">
            查看场景图大图预览，当前第 {lightboxIndex + 1} 张，共 {images.length} 张，可使用左右方向键切换。
          </DialogDescription>

          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-3 right-3 z-10 h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute top-3 left-3 z-10 text-white/80 text-sm font-mono bg-black/60 px-2 py-0.5 rounded">
            {lightboxIndex + 1} / {images.length}
          </div>

          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          <div className="flex items-center justify-center w-full h-[80vh]">
            {lightboxIndex >= 0 && lightboxIndex < images.length && (
              <LightboxImage src={images[lightboxIndex]} index={lightboxIndex} baseDir={baseDir} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LightboxImage({ src, index, baseDir }: { src: string; index: number; baseDir?: string }) {
  const resolvedSrc = useResolvedImageSrc([src], baseDir);

  if (!resolvedSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-8 w-8 text-white/25" />
      </div>
    );
  }

  return <img src={resolvedSrc} alt={`Scene ${index + 1}`} className="max-w-full max-h-full object-contain" />;
}

function LazyImage({
  src,
  alt,
  baseDir,
  variant,
}: {
  src: string;
  alt: string;
  baseDir?: string;
  variant: "compact" | "filmstrip";
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const resolvedSrc = useResolvedImageSrc([src], baseDir);

  useEffect(() => {
    if (resolvedSrc) {
      setLoaded(false);
      setError(false);
      return;
    }

    setLoaded(false);
    setError(false);
  }, [resolvedSrc]);

  if (error || !resolvedSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <div
      className={
        variant === "filmstrip"
          ? "h-full w-full overflow-hidden rounded-quiet"
          : "h-full w-full overflow-hidden rounded-md"
      }
    >
      {!loaded && <div className="h-full w-full animate-pulse bg-muted/30" />}
      <img
        src={resolvedSrc}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`h-full w-full ${variant === "filmstrip" ? "object-cover" : "object-cover"} ${loaded ? "" : "invisible"}`}
      />
    </div>
  );
}
