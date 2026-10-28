import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, Highlighter, LibraryBig } from "lucide-react";
import { api } from "@/api";
import { useRemoteDevice } from "@/api/hooks";
import { ReadingSettings } from "@/components/reader/ReadingSettings";
import { PhoneSettings } from "@/components/settings/PhoneSettings";
import { CenterColumn, PageHeader } from "@/components/shell/Page";
import { Button } from "@/components/ui/Button";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-3 pt-6">
      <h2 className="pb-3 font-display text-[15px] leading-5 font-semibold">{title}</h2>
      <div className="rounded-md p-4 shadow-[inset_0_0_0_1px_var(--detail)]">{children}</div>
    </section>
  );
}

function LinkRow({ to, icon: Icon, label }: { to: string; icon: typeof Highlighter; label: string }) {
  return (
    <Link to={to} className="-mx-2 flex items-center gap-3 rounded-sm px-2 py-2.5 transition-hover hover:bg-surface-hover">
      <Icon size={20} strokeWidth={1.75} className="text-fg-2" aria-hidden />
      <span className="flex-1 text-[15px] leading-5 font-medium">{label}</span>
      <ChevronRight size={18} className="text-fg-3" aria-hidden />
    </Link>
  );
}

export function SettingsPage() {
  const [confirmReset, setConfirmReset] = useState(false);
  const device = useRemoteDevice();
  return (
    <CenterColumn className="pb-10">
      <PageHeader title="Settings" />
      <Group title="Reading">
        <ReadingSettings showPreview />
      </Group>

      <Group title="Library">
        <LinkRow to="/" icon={LibraryBig} label="Library" />
        <LinkRow to="/highlights" icon={Highlighter} label="Highlights" />
      </Group>

      <Group title="Connection">
        {api.mode === "mock" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] leading-5 text-fg-2">
              Preview mode: sample texts and anything you drop in are kept in this browser. Set{" "}
              <code className="font-mono text-[13px] text-fg">VITE_API_URL</code> to use the backend.
            </p>
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px]">Clear saved items, progress and uploads in this browser?</span>
                <Button size="sm" variant="tertiary" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    localStorage.removeItem("pager.mock.v1");
                    window.location.reload();
                  }}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setConfirmReset(true)}>
                  Reset preview data
                </Button>
              </div>
            )}
          </div>
        ) : device ? (
          <p className="text-[14px] leading-5 text-fg-2">
            Reading from your computer as <span className="font-semibold text-fg">{device.name}</span>.
          </p>
        ) : (
          <p className="text-[14px] leading-5 text-fg-2">
            Connected to the backend at <code className="font-mono text-[13px] text-fg">/api</code>.
          </p>
        )}
      </Group>

      {api.mode === "http" && device === null && (
        <Group title="Phone">
          <PhoneSettings />
        </Group>
      )}
    </CenterColumn>
  );
}
