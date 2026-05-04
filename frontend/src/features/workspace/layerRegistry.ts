import type { FC } from "react";
import type { LucideProps } from "lucide-react";

/**
 * A named section inside a workspace layer (e.g., "Environment", "Simulation").
 * Each section maps to a tab or accordion panel in the right control rail.
 */
export interface WorkspaceSection {
  id: string;
  label: string;
  icon?: FC<LucideProps>;
}

/**
 * A workspace layer groups related sections under a shared concept.
 * Example: the "World" layer contains "Environment" and "Simulation" sections.
 * Future layers might be "Analytics", "Recording", "Materials", etc.
 */
export interface WorkspaceLayer {
  id: string;
  label: string;
  icon: FC<LucideProps>;
  description?: string;
  sections: WorkspaceSection[];
}

/** The full registry of layers available in a workspace. */
export type LayerRegistry = WorkspaceLayer[];
