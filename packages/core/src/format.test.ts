import { describe, expect, it } from "vitest";

import { formatDay, formatDistance, formatDuration, formatRand, formatTime, localDate } from "./format";

describe("formatRand", () => {
  it("formats whole rand with space thousands separators", () => {
    expect(formatRand(22000)).toBe("R220");
    expect(formatRand(286000)).toBe("R2 860");
    expect(formatRand(123456700)).toBe("R1 234 567");
  });
  it("keeps cents when there are any", () => {
    expect(formatRand(22050)).toBe("R220.50");
    expect(formatRand(5)).toBe("R0.05");
  });
});

describe("formatDuration", () => {
  it("handles minutes and hours", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});

describe("dates in Johannesburg time", () => {
  const iso = "2026-10-22T08:30:00Z"; // 10:30 SAST
  it("formats the local time and day", () => {
    expect(formatTime(iso)).toBe("10:30");
    expect(formatDay(iso)).toBe("Thu 22 Oct");
  });
  it("gives the local date near midnight", () => {
    expect(localDate(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
  });
});

describe("formatDistance", () => {
  it("uses metres under 1 km", () => {
    expect(formatDistance(0.8)).toBe("800 m");
    expect(formatDistance(2.345)).toBe("2.3 km");
  });
});
