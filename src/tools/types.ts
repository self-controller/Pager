import type { ComponentType } from "react";
import type { DocumentDetail, ReadingProgress, Section } from "@/api/types";

/**
 * The seam for smart tools. A tool registers once (see registry.ts) and can contribute:
 *  - a Panel, rendered in the reader's right-hand tool panel and on the Assistant page;
 *  - selection actions, shown in a small menu above selected text in the reader.
 * Tools get read-only context; anything they persist goes through the backend's reserved
 * /api/tools/* namespace (see CONTRACT.md).
 */

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
}

/** A text selection inside the reader body, as character offsets into the section's text. */
export interface TextSelection {
  text: string;
  sectionId: string;
  /** Offset of the first selected character in the section's plain text (textContent). */
  start: number;
  /** Offset just past the last selected character. */
  end: number;
  /** Viewport rectangle of the selection, for positioning UI; null when unknown. */
  rect: { top: number; left: number; width: number; height: number } | null;
}

export interface ToolContext {
  /** Null on the Assistant page when no document is open. */
  doc: DocumentDetail | null;
  section: Section | null;
  selection: TextSelection | null;
  progress?: ReadingProgress;
}

export interface ToolPanelProps {
  context: ToolContext;
  /** Ask the reader to close the tool panel. */
  close: () => void;
}

export interface SelectionAction {
  id: string;
  label: string;
  icon?: ComponentType<IconProps>;
  run: (context: ToolContext & { selection: TextSelection }) => void | Promise<void>;
}

export interface PagerTool {
  /** Stable, unique id, e.g. "define" or "ask". */
  id: string;
  label: string;
  description?: string;
  icon: ComponentType<IconProps>;
  Panel?: ComponentType<ToolPanelProps>;
  selectionActions?: SelectionAction[];
}
