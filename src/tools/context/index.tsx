import { lazy, Suspense, useEffect } from "react";
import { Landmark } from "lucide-react";
import type { PagerTool, ToolContext, ToolPanelProps } from "@/tools/types";
import { closeCard, openCard, useContextCard } from "./store";

// The panel, its graphics and their helpers load the first time the panel opens; the card the
// first time "Context for this" is tapped.
const ContextPanel = lazy(() => import("./ContextPanel").then((m) => ({ default: m.ContextPanel })));
const ContextCard = lazy(() => import("./ContextCard").then((m) => ({ default: m.ContextCard })));

function Panel(props: ToolPanelProps) {
  return (
    <Suspense fallback={null}>
      <ContextPanel {...props} />
    </Suspense>
  );
}

/** The "Context for this" card, over the text. Another chapter or document, or leaving the reader, closes it. */
function Overlay({ context }: { context: ToolContext }) {
  const card = useContextCard();
  const docId = context.doc?.id;
  const sectionId = context.section?.id;
  useEffect(() => closeCard, [docId, sectionId]);
  if (!card || !context.doc || card.docId !== docId) return null;
  return (
    <Suspense fallback={null}>
      <ContextCard key={card.id} card={card} doc={context.doc} />
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
  Overlay,
  // Web only: the iPhone app's text menu is a fixed list (NativeMenuItem in src/lib/native.ts).
  selectionActions: [
    {
      id: "context-for-this",
      label: "Context for this",
      icon: Landmark,
      run: ({ doc, selection }) => {
        if (!doc) return;
        openCard({ docId: doc.id, text: selection.text, rect: selection.rect });
        // The selection menu goes; the card takes its place.
        window.getSelection()?.removeAllRanges();
      },
    },
  ],
};
