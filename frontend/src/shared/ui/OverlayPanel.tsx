import { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/shared/store/useApp";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
  /** Renders before the close control (e.g. expand / secondary actions). */
  headerActions?: ReactNode;
  /** Edge-to-edge panel: fills the viewport, no outer padding, square corners. */
  fullBleed?: boolean;
  /** Merged into the scrollable content wrapper below the header. */
  contentClassName?: string;
}

export function OverlayPanel({
  title,
  subtitle,
  children,
  size = "lg",
  headerActions,
  fullBleed = false,
  contentClassName,
}: Props) {
  const close = useApp((s) => s.closeOverlay);
  const widths = { md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return (
    <div
      className={cn(
        "fixed inset-0 z-[1000] flex bg-foreground/20 backdrop-blur-sm animate-fade-in",
        fullBleed ? "items-stretch justify-stretch p-0" : "items-center justify-center p-4",
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={close}
    >
      <div
        className={cn(
          "w-full flex flex-col overflow-hidden holo-surface",
          fullBleed ? "h-full max-h-none max-w-none rounded-none" : cn(widths[size], "max-h-[90vh] rounded-3xl"),
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="relative z-10 flex items-start justify-between gap-4 p-5 border-b border-[hsl(var(--holo-cyan)/0.4)] shrink-0">
          <div>
            <h2 className="font-display text-2xl holo-text-glow">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {headerActions}
            <Button variant="ghost" size="icon" onClick={close} aria-label="Close" className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </header>
        <div
          className={cn(
            "relative z-10 flex-1 min-h-0",
            fullBleed ? "basis-0 flex h-full min-h-0 flex-col overflow-hidden" : "overflow-y-auto p-6",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
