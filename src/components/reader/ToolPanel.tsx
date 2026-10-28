import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { useTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";

/**
 * The reader's right-hand panel. Renders each registered tool's Panel with the reading context.
 * With nothing registered (this pass), it is an empty, quiet slot.
 */
export function ToolPanel({
  context,
  onClose,
  showHeader = true,
}: {
  context: ToolContext;
  onClose: () => void;
  showHeader?: boolean;
}) {
  const tools = useTools();
  const withPanels = tools.filter((t) => t.Panel);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const active = withPanels.find((t) => t.id === activeId) ?? withPanels[0];

  return (
    <div className="flex h-full flex-col">
      {showHeader && (
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-detail pr-2 pl-5">
          <h2 className="font-display text-[15px] leading-5 font-semibold">Tools</h2>
          <IconButton icon={X} label="Close tools" onClick={onClose} />
        </div>
      )}
      {withPanels.length > 1 && active && (
        <div className="border-b border-detail p-3">
          <SegmentedTabs
            label="Tool"
            value={active.id}
            onChange={setActiveId}
            options={withPanels.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active?.Panel ? (
          <active.Panel context={context} close={onClose} />
        ) : (
          <EmptyState icon={Sparkles} title="No tools yet">
            Tools you add will open here, beside the text. They see the document, the chapter you're on and anything you select.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
