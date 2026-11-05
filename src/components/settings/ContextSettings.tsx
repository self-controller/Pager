import { useEffect, useId, useState, type FormEvent } from "react";
import type { ContextLevel } from "@/api/types";
import { useAppSettings, useUpdateAppSettings } from "@/api/hooks";
import { Button } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { updateSettings, useSettings } from "@/state/settings";

/** Who Context briefings are written for. The same setting as the switcher in the Context panel. */
export function ContextLevelSetting() {
  const { contextLevel } = useSettings();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] leading-5 font-medium">Context written for</span>
      <SegmentedTabs<ContextLevel>
        label="Context written for"
        stretch
        value={contextLevel}
        onChange={(level) => updateSettings({ contextLevel: level })}
        options={[
          { value: "general", label: "General reader" },
          { value: "student", label: "Student" },
          { value: "scholar", label: "Scholar" },
        ]}
      />
      <span className="text-[13px] leading-[18px] text-fg-2">
        How much background a briefing assumes, how deep it goes into the debates, and what it suggests reading afterwards. Each
        level is its own briefing.
      </span>
    </div>
  );
}

/** How many paid briefings each paired phone may start in a day. The computer only. */
export function PhoneContextLimit() {
  const settings = useAppSettings();
  const update = useUpdateAppSettings();
  const id = useId();
  const saved = settings.data?.context.phoneDailyLimit;
  const [value, setValue] = useState("");
  useEffect(() => {
    if (saved !== undefined) setValue(String(saved));
  }, [saved]);
  if (saved === undefined) return null;
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (valid && n !== saved) update.mutate({ context: { phoneDailyLimit: n } });
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] leading-5 font-medium">
        New briefings a day from each phone
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => save()}
          className="h-10 w-24 rounded-sm bg-surface px-3 text-[15px] tabular-nums shadow-[inset_0_0_0_1px_var(--detail)] focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
        />
        {valid && n !== saved && (
          <Button size="sm" variant="secondary" type="submit" disabled={update.isPending}>
            Save
          </Button>
        )}
      </div>
      <span className="text-[13px] leading-[18px] text-fg-2">
        {valid
          ? "A new briefing or a Refresh from a paired phone uses your API key, so each phone gets this many in 24 hours. Opening one already made is free, and this computer is never limited. 0 lets phones only open briefings already made."
          : "A whole number from 0 to 100."}
      </span>
      {update.error && <span className="text-[13px] leading-[18px] text-error">{update.error.message}</span>}
    </form>
  );
}
