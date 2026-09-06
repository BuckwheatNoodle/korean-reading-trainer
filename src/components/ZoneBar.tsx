import { PACE_ZONES } from "../lib/training";

interface ZoneBarProps {
  pace?: number;
  baseline?: number;
  compact?: boolean;
}

const SCALE_MIN = 30;
const SCALE_MAX = 110;

function position(value: number): number {
  return Math.min(100, Math.max(0, ((value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
}

export function ZoneBar({ pace, baseline, compact = false }: ZoneBarProps) {
  const visibleZones = PACE_ZONES.map((zone) => ({
    ...zone,
    displayMin: Math.max(SCALE_MIN, zone.min),
    displayMax: Math.min(SCALE_MAX, zone.max),
  })).filter((zone) => zone.displayMax > zone.displayMin);

  return (
    <div className={`zone-chart ${compact ? "zone-chart--compact" : ""}`}>
      <div className="zone-chart__labels" aria-hidden="true">
        {visibleZones.map((zone) => (
          <span
            key={zone.id}
            style={{
              left: `${position(zone.displayMin)}%`,
              width: `${position(zone.displayMax) - position(zone.displayMin)}%`,
            }}
          >
            {zone.shortLabel}
          </span>
        ))}
      </div>
      <div className="zone-chart__track">
        {visibleZones.map((zone) => (
          <div
            key={zone.id}
            className="zone-chart__segment"
            style={{
              width: `${position(zone.displayMax) - position(zone.displayMin)}%`,
              backgroundColor: zone.color,
            }}
          />
        ))}
        {baseline !== undefined && (
          <div
            className="zone-marker zone-marker--baseline"
            style={{ left: `${position(baseline)}%` }}
            title={`無音実測 ${baseline.toFixed(1)}`}
          >
            <span>▲</span>
          </div>
        )}
        {pace !== undefined && (
          <div
            className="zone-marker zone-marker--pace"
            style={{ left: `${position(pace)}%` }}
            title={`今回 ${pace.toFixed(1)}`}
          >
            <span>{pace.toFixed(0)}</span>
          </div>
        )}
      </div>
      {!compact && (
        <div className="zone-chart__scale" aria-hidden="true">
          <span>30</span><span>35</span><span>49</span><span>62</span><span>72</span><span>85</span><span>110</span>
        </div>
      )}
    </div>
  );
}
