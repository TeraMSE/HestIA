import { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/shared/store/useApp";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}

export function OverlayPanel({ title, subtitle, children, size = "lg" }: Props) {
  const close = useApp((s) => s.closeOverlay);
  const widths = { md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-foreground/20 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={close}
    >
      <div
        className={`w-full ${widths[size]} max-h-[90vh] flex flex-col rounded-3xl overflow-hidden holo-surface`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="relative z-10 flex items-start justify-between gap-4 p-5 border-b border-[hsl(var(--holo-cyan)/0.4)]">
          <div>
            <h2 className="font-display text-2xl holo-text-glow">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close" className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]">
            <X className="h-5 w-5" />
          </Button>
        </header>
        <div className="relative z-10 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
