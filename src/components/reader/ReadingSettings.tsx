import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import {
  FONT_OFFSET_MAX,
  FONT_OFFSET_MIN,
  updateSettings,
  useSettings,
  type ThemeSetting,
  type Typeface,
} from "@/state/settings";

const BASE_SIZE = 19;

/** Text size, typeface and theme. Used in the reader's popover and on the Settings page. */
export function ReadingSettings({ showPreview }: { showPreview?: boolean }) {
  const s = useSettings();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] leading-5 font-medium">Text size</span>
        <div className="flex items-center gap-1">
          <IconButton
            icon={Minus}
            label="Smaller text"
            size="sm"
            variant="secondary"
            disabled={s.fontOffset <= FONT_OFFSET_MIN}
            onClick={() => updateSettings({ fontOffset: s.fontOffset - 1 })}
          />
          <span className="w-12 text-center font-byline text-[13px] tabular-nums text-fg-2" aria-live="polite">
            {BASE_SIZE + s.fontOffset}px
          </span>
          <IconButton
            icon={Plus}
            label="Larger text"
            size="sm"
            variant="secondary"
            disabled={s.fontOffset >= FONT_OFFSET_MAX}
            onClick={() => updateSettings({ fontOffset: s.fontOffset + 1 })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[14px] leading-5 font-medium">Typeface</span>
        <SegmentedTabs<Typeface>
          label="Typeface"
          stretch
          value={s.typeface}
          onChange={(typeface) => updateSettings({ typeface })}
          options={[
            { value: "serif", label: "Serif" },
            { value: "sans", label: "Sans" },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[14px] leading-5 font-medium">Theme</span>
        <SegmentedTabs<ThemeSetting>
          label="Theme"
          stretch
          value={s.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      {showPreview && (
        <p className="markup mt-2 rounded-md bg-surface-hover p-4 shadow-[inset_0_0_0_1px_var(--detail)]">
          Reading maketh a full man; conference a ready man; and writing an exact man.
        </p>
      )}
    </div>
  );
}
