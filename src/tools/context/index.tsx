import { lazy, Suspense } from "react";
import { Landmark } from "lucide-react";
import type { PagerTool, ToolPanelProps } from "@/tools/types";

// The panel, its graphics and their helpers load the first time the panel opens.
const ContextPanel = lazy(() => import("./ContextPanel").then((m) => ({ default: m.ContextPanel })));

function Panel(props: ToolPanelProps) {
  return (
    <Suspense fallback={null}>
      <ContextPanel {...props} />
    </Suspense>
  );
}

/** Context: a sourced briefing on the open book's historical moment, its author and the conversation it joined. */
export const contextTool: PagerTool = {
  id: "context",
  label: "Context",
  description: "A sourced briefing on the book's historical moment, its author's situation and the conversation it joined.",
  icon: Landmark,
  Panel,
};
