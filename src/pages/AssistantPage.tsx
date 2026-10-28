import { Sparkles } from "lucide-react";
import { CenterColumn, PageHeader } from "@/components/shell/Page";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTools } from "@/tools/registry";

/** Full-page home for smart tools. Empty until tools are registered. */
export function AssistantPage() {
  const tools = useTools();
  return (
    <CenterColumn className="pb-10">
      <PageHeader title="Assistant" />
      {tools.length === 0 ? (
        <EmptyState icon={Sparkles} title="Smart tools will live here">
          When tools are added, they show up on this page and beside the text while you read.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6 px-3 pt-4">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <section key={tool.id} className="rounded-md shadow-[inset_0_0_0_1px_var(--detail)]">
                <header className="flex items-center gap-3 border-b border-detail px-4 py-3">
                  <Icon size={18} aria-hidden />
                  <div>
                    <h2 className="font-display text-[15px] leading-5 font-semibold">{tool.label}</h2>
                    {tool.description && <p className="text-[13px] leading-[18px] text-fg-2">{tool.description}</p>}
                  </div>
                </header>
                {tool.Panel && <tool.Panel context={{ doc: null, section: null, selection: null }} close={() => {}} />}
              </section>
            );
          })}
        </div>
      )}
    </CenterColumn>
  );
}
