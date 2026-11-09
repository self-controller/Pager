import { isNativeApp } from "./native";
import { useMediaQuery } from "./useMediaQuery";

/** Below the side nav's breakpoint: the width where the tab bar shows (BottomTabBar's `md:hidden`). */
export const PHONE_QUERY = "(max-width: 767px)";

/**
 * Whether popups take their phone shape (a bottom sheet): in a browser under 768px, and always in
 * the iPhone app, which is a phone at every width.
 */
export function useIsPhone(): boolean {
  const narrow = useMediaQuery(PHONE_QUERY);
  return isNativeApp() || narrow;
}
