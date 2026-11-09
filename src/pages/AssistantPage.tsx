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
        <div className="flex flex-col gap-6 px-3 pt-4">
          {tools.map((tool) => (
            // A real border, clipped without making a scroll box: a tool's sticky rows and backgrounds
            // would paint over an inset-shadow outline.
            <section key={tool.id} aria-label={tool.label} className="overflow-clip rounded-md border border-detail">
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
