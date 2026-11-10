import { describe, expect, it } from "vitest";
import { offlineLabel } from "@/components/shell/OfflineLine";
import { formatBytes, formatWhen } from "@/lib/format";
import { emptyClient } from "@/offline/port";
import { createOfflineStore } from "@/offline/state";

const now = new Date(2026, 10, 10, 15, 30);
const at = (h: number, m: number, day = 10) => new Date(2026, 10, day, h, m).toISOString();

describe("formatWhen", () => {
  it("is the time today and the date on another day", () => {
    expect(formatWhen(at(14, 14), now)).toBe("2:14 pm");
    expect(formatWhen(at(9, 5), now)).toBe("9:05 am");
    expect(formatWhen(at(23, 50, 9), now)).toBe("Nov 9");
    expect(formatWhen(null, now)).toBe("");
    expect(formatWhen("not a date", now)).toBe("");
  });
});

describe("formatBytes", () => {
  it("is in KB under a megabyte, then MB", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(400)).toBe("1 KB");
    expect(formatBytes(840_000)).toBe("840 KB");
    expect(formatBytes(1_530_000)).toBe("1.5 MB");
    expect(formatBytes(250_000_000)).toBe("250 MB");
  });
});

describe("the offline line", () => {
  const state = (patch: object) => createOfflineStore({ available: true, ...patch }).get();

  it("shows only in the app, and only while the computer is known to be out of reach", () => {
    expect(offlineLabel(createOfflineStore({ online: false }).get(), now)).toBeNull();
    expect(offlineLabel(state({ online: true }), now)).toBeNull();
    expect(offlineLabel(state({ online: null }), now)).toBeNull();
    expect(offlineLabel(state({ online: false }), now)).toBe("Offline · not synced yet");
  });

  it("says when the copy was last brought up to date", () => {
    const client = { ...emptyClient(), lastSyncedAt: at(14, 14) };
    expect(offlineLabel(state({ online: false, client }), now)).toBe("Offline · synced 2:14 pm");
    expect(offlineLabel(state({ online: false, lastOnlineAt: at(8, 0, 8) }), now)).toBe("Offline · synced Nov 8");
  });
});
