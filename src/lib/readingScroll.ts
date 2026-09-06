interface ReadingScrollMetrics {
  scrollTop: number;
  viewportTop: number;
  viewportBottom: number;
  activeTop: number;
  activeBottom: number;
  comfortMargin: number;
}

/**
 * Returns a scroll position only when the active sentence is leaving the
 * comfortable visible area. All element positions use viewport coordinates,
 * so the calculation is independent of the element's offset parent.
 */
export function getReadingScrollTarget({
  scrollTop,
  viewportTop,
  viewportBottom,
  activeTop,
  activeBottom,
  comfortMargin,
}: ReadingScrollMetrics): number | null {
  const viewportHeight = Math.max(0, viewportBottom - viewportTop);
  const margin = Math.min(Math.max(0, comfortMargin), viewportHeight / 3);
  const safeTop = viewportTop + margin;
  const safeBottom = viewportBottom - margin;
  const activeHeight = Math.max(0, activeBottom - activeTop);
  const safeHeight = Math.max(0, safeBottom - safeTop);

  if (activeHeight > safeHeight || activeTop < safeTop) {
    return Math.max(0, scrollTop + activeTop - safeTop);
  }
  if (activeBottom > safeBottom) {
    return Math.max(0, scrollTop + activeBottom - safeBottom);
  }
  return null;
}
