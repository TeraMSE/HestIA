import { useState, type ReactNode } from "react";
import { X, Maximize2, Minimize2, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  leftRail?: ReactNode;
  rightRail?: ReactNode;
  bottomDock?: ReactNode | ((isMaximized: boolean) => ReactNode);
  /** Slot for extra controls in the header center (e.g., 2D/3D toggle) */
  headerExtras?: ReactNode;
  children: ReactNode;
  defaultMaximized?: boolean;
  mode?: "overlay" | "fullscreen";
}

/**
 * SimWorkspace — command-center layout for the 3D simulation workspace.
 *
 * Overlay mode keeps the workspace inside a centered modal shell.
 * Fullscreen mode expands it to fill the viewport.
 */
export function SimWorkspace({
  title,
  subtitle,
  onClose,
  leftRail,
  rightRail,
  bottomDock,
  headerExtras,
  children,
  defaultMaximized = false,
  mode = "overlay",
}: Props) {
  const [isMaximized, setIsMaximized] = useState(defaultMaximized);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const showLeft = Boolean(leftRail) && leftOpen && !isMaximized;
  const showRight = Boolean(rightRail) && rightOpen && !isMaximized;

  const outerClassName =
    mode === "overlay"
      ? "fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-3 bg-foreground/18 backdrop-blur-sm animate-fade-in"
      : "fixed inset-0 z-[1000] flex flex-col bg-[#06060f] animate-fade-in";

  const shellClassName =
    mode === "overlay"
      ? isMaximized
        ? "w-full h-full rounded-[28px] overflow-hidden holo-surface border border-[hsl(var(--holo-cyan)/0.22)] shadow-[0_30px_120px_rgba(0,0,0,0.65)]"
        : "w-full max-w-[min(98vw,1700px)] h-[min(92vh,1000px)] rounded-[20px] overflow-hidden holo-surface border border-[hsl(var(--holo-cyan)/0.22)] shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
      : "w-full h-full overflow-hidden";
  // make shell relative so we can absolutely position overlays (bottom dock) when maximized
  const shellClassNameRel = shellClassName + " relative";

  const headerClassName =
    mode === "overlay"
      ? "h-11 shrink-0 flex items-center gap-1.5 px-3 border-b border-[hsl(var(--holo-cyan)/0.18)] bg-black/20 backdrop-blur-xl"
      : "h-11 shrink-0 flex items-center gap-1.5 px-3 border-b border-[hsl(var(--holo-cyan)/0.15)] bg-[#08081a]";

  const mainClassName = `flex-1 flex flex-col min-w-0 relative overflow-hidden bg-transparent`;

  return (
    <div className={outerClassName} role="dialog" aria-modal="true" aria-label={title}>
      <div className={shellClassNameRel}>
        <header className={headerClassName}>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/8 transition-colors"
            aria-label="Close workspace"
          >
            <X className="h-4 w-4" />
          </button>

          {leftRail && (
            <button
              onClick={() => setLeftOpen((value) => !value)}
              disabled={isMaximized}
              className={`hidden md:flex p-1.5 rounded-lg transition-colors ${
                leftOpen && !isMaximized
                  ? "text-[hsl(var(--holo-cyan)/0.75)]"
                  : "text-gray-700 hover:text-gray-400"
              } disabled:opacity-30 disabled:pointer-events-none`}
              aria-label="Toggle context panel"
            >
              <ChevronLeft className={`h-4 w-4 transition-transform duration-200 ${!leftOpen ? "rotate-180" : ""}`} />
            </button>
          )}

          <div className="flex-1 min-w-0 px-2">
            <span className="text-sm font-semibold text-white truncate">{title}</span>
            {subtitle && <span className="text-xs text-gray-500 ml-2 hidden lg:inline truncate">{subtitle}</span>}
          </div>

          {headerExtras && <div className="flex items-center gap-2">{headerExtras}</div>}

          {rightRail && (
            <button
              onClick={() => setRightOpen((value) => !value)}
              disabled={isMaximized}
              className={`hidden md:flex p-1.5 rounded-lg transition-colors ${
                rightOpen && !isMaximized
                  ? "text-[hsl(var(--holo-cyan)/0.75)]"
                  : "text-gray-700 hover:text-gray-400"
              } disabled:opacity-30 disabled:pointer-events-none`}
              aria-label="Toggle control panel"
            >
              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${!rightOpen ? "rotate-180" : ""}`} />
            </button>
          )}

          <button
            onClick={() => setIsMaximized((value) => !value)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/8 transition-colors"
            aria-label={isMaximized ? "Restore panels" : "Maximize 3D viewport"}
          >
            {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </header>

        <div className="flex-1 flex min-h-0 overflow-hidden h-[calc(100%-44px)]">
          {showLeft && (
            <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-[hsl(var(--sidebar-border)/0.12)] holo-surface overflow-y-auto">
              {leftRail}
            </aside>
          )}

          <main className={mainClassName}>{children}</main>

          {showRight && (
            <aside className="hidden md:flex w-72 shrink-0 flex-col border-l border-[hsl(var(--sidebar-border)/0.12)] holo-surface overflow-hidden">
              {rightRail}
            </aside>
          )}
        </div>

        {(() => {
          const content = typeof bottomDock === "function" ? bottomDock(isMaximized) : bottomDock;
          if (!content) return null;
          // Always render dock as an overlay so center area fills the shell;
          // compact/full difference is handled by the caller's content sizing.
          return <div className="absolute left-0 right-0 bottom-0 z-40">{content}</div>;
        })()}
      </div>
    </div>
  );
}