import { Sparkles } from "lucide-react";
import { FullColumn, PageHeader } from "@/components/shell/Page";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTools } from "@/tools/registry";

/** Full-page home for smart tools, as wide as the window (a book's Context needs the room). Empty until tools are registered. */
export function AssistantPage() {
  const tools = useTools();
  return (
    <FullColumn className="pb-10">
      <PageHeader title="Assistant" />
      {tools.length === 0 ? (
        <EmptyState icon={Sparkles} title="Smart tools will live here">
          When tools are added, they show up on this page and beside the text while you read.
        </EmptyState>
      ) : (
        // No box around a tool: its rows run the column's width, and it pads its text to line up with
        // the page's title (16 px on a phone, 12 px inside the column from 768).
        <div className="flex flex-col gap-6 pt-2">
          {tools.map((tool) => (
            <section key={tool.id} aria-label={tool.label}>
              {tool.Page ? (
                <tool.Page />
              ) : (
                tool.Panel && <tool.Panel context={{ doc: null, section: null, selection: null }} close={() => {}} />
              )}
            </section>
          ))}
        </div>
      )}
    </FullColumn>
  );
}
