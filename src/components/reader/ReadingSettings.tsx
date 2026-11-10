import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { haptic, prepareHaptic } from "@/lib/native";
import { PHONE_QUERY } from "@/lib/useIsPhone";
import { useMediaQuery } from "@/lib/useMediaQuery";
import {
  updateSettings,
  useSettings,
  type LayoutSetting,
  type PageTurn,
  type ThemeSetting,
  type Typeface,
} from "@/state/settings";
import { bodyBase, bodySize, canGrow, canShrink, largerOffset, smallerOffset } from "./textSize";

/** One text-size step, with a selection tick in the iPhone app. */
function stepSize(fontOffset: number) {
  updateSettings({ fontOffset });
  haptic("selection");
}

/** Text size, typeface, theme, layout and page turn. Used in the reader's popover and on the Settings page. */
export function ReadingSettings({ showPreview }: { showPreview?: boolean }) {
  const s = useSettings();
  // The same width the stylesheet switches the body size at (tokens.css), so the readout is the real size.
  const base = bodyBase(useMediaQuery(PHONE_QUERY));
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
            disabled={!canShrink(base, s.fontOffset)}
            onPointerDown={() => prepareHaptic("selection")}
            onClick={() => stepSize(smallerOffset(base, s.fontOffset))}
          />
          <span className="w-12 text-center font-byline text-[13px] tabular-nums text-fg-2" aria-live="polite">
            {bodySize(base, s.fontOffset)}px
          </span>
          <IconButton
            icon={Plus}
            label="Larger text"
            size="sm"
            variant="secondary"
            disabled={!canGrow(s.fontOffset)}
            onPointerDown={() => prepareHaptic("selection")}
            onClick={() => stepSize(largerOffset(base, s.fontOffset))}
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
      <div className="flex flex-col gap-2">
        <span className="text-[14px] leading-5 font-medium">Layout</span>
        <SegmentedTabs<LayoutSetting>
          label="Layout"
          stretch
          value={s.layout}
          onChange={(layout) => updateSettings({ layout })}
          options={[
            { value: "scroll", label: "Scroll" },
            { value: "paged", label: "Pages" },
          ]}
        />
        <span className="text-[13px] leading-[18px] text-fg-2">
          {s.layout === "scroll" ? "Each chapter scrolls. Swipe sideways for the next one." : "Turn the pages of each chapter."}
        </span>
      </div>
      {s.layout === "paged" && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] leading-5 font-medium">Page turn</span>
          <SegmentedTabs<PageTurn>
            label="Page turn"
            stretch
            value={s.pageTurn}
            onChange={(pageTurn) => updateSettings({ pageTurn })}
            options={[
              { value: "slide", label: "Slide" },
              { value: "fade", label: "Fade" },
              { value: "none", label: "None" },
            ]}
          />
          <span className="text-[13px] leading-[18px] text-fg-2">Instant while Reduce Motion is on.</span>
        </div>
      )}
      {showPreview && (
        <p className="markup mt-2 rounded-md bg-surface-hover p-4 shadow-[inset_0_0_0_1px_var(--detail)]">
          Reading maketh a full man; conference a ready man; and writing an exact man.
        </p>
      )}
    </div>
  );
}
