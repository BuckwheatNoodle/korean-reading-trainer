import { describe, expect, it } from "vitest";
import { getReadingScrollTarget } from "./readingScroll";

describe("reading scroll positioning", () => {
  it("does not move while the next sentence is already comfortably visible", () => {
    expect(getReadingScrollTarget({
      scrollTop: 0,
      viewportTop: 200,
      viewportBottom: 700,
      activeTop: 290,
      activeBottom: 390,
      comfortMargin: 70,
    })).toBeNull();
  });

  it("scrolls only enough to reveal a sentence approaching the bottom edge", () => {
    expect(getReadingScrollTarget({
      scrollTop: 120,
      viewportTop: 200,
      viewportBottom: 700,
      activeTop: 590,
      activeBottom: 680,
      comfortMargin: 70,
    })).toBe(170);
  });

  it("uses viewport-relative coordinates even when the reading panel starts far down the page", () => {
    expect(getReadingScrollTarget({
      scrollTop: 0,
      viewportTop: 520,
      viewportBottom: 920,
      activeTop: 600,
      activeBottom: 690,
      comfortMargin: 60,
    })).toBeNull();
  });
});
