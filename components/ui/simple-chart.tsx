"use client";

import { useMemo } from "react";

interface SimpleBarChartProps {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  className?: string;
}

export function SimpleBarChart({ data, height = 200, className = "" }: SimpleBarChartProps) {
  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-end space-x-2 h-full" style={{ height }}>
        {data.map((item, index) => (
          <div key={index} className="flex-1 flex flex-col items-center space-y-1">
            <div className="w-full flex justify-center">
              <div
                className={`w-full max-w-12 rounded-t transition-all duration-500 ${
                  item.color || "bg-nvidia-green"
                }`}
                style={{
                  height: `${(item.value / maxValue) * (height - 40)}px`,
                  minHeight: item.value > 0 ? "4px" : "0px",
                }}
              />
            </div>
            <div className="text-xs text-center text-muted-foreground font-medium">
              {item.label}
            </div>
            <div className="text-xs text-center font-bold">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SimpleLineChartProps {
  data: Array<{ label: string; value: number }>;
  height?: number;
  className?: string;
  color?: string;
}

export function SimpleLineChart({
  data,
  height = 200,
  className = "",
  color = "text-nvidia-green"
}: SimpleLineChartProps) {
  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);
  const minValue = useMemo(() => Math.min(...data.map(d => d.value), 0), [data]);
  const range = maxValue - minValue || 1;

  const getYPosition = (value: number) => {
    return height - 40 - ((value - minValue) / range) * (height - 60);
  };

  const pathData = useMemo(() => {
    if (data.length === 0) return "";

    const points = data.map((item, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = getYPosition(item.value);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");

    return points;
  }, [data, height, range, minValue]);

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <div className="relative w-full h-full">
        <svg viewBox={`0 0 100 ${height}`} className="w-full h-full">
          <path
            d={pathData}
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            className={color}
          />
          {data.map((item, index) => (
            <circle
              key={index}
              cx={(index / (data.length - 1)) * 100}
              cy={getYPosition(item.value)}
              r="3"
              className={`${color} fill-current`}
            />
          ))}
        </svg>

        {/* Labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between">
          {data.map((item, index) => (
            <div key={index} className="flex flex-col items-center">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="text-xs font-bold">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface EventsTimelineProps {
  events: Array<{ timestamp: string; count: number }>;
  className?: string;
  color?: string;
}

export function EventsTimeline({ events, className = "", color = "bg-nvidia-purple" }: EventsTimelineProps) {
  const hourlyData = useMemo(() => {
    const now = new Date();
    const hours = [];

    // Debug: Log event timestamps and time windows
    if (events.length > 0) {
      console.log('[Timeline Debug] Current time:', now.toISOString());
      console.log('[Timeline Debug] Events:', events.map(e => ({
        timestamp: e.timestamp,
        parsed: new Date(e.timestamp).toISOString(),
        parsedLocal: new Date(e.timestamp).toLocaleString(),
        hour: new Date(e.timestamp).getHours()
      })));
    }

    for (let i = 23; i >= 0; i--) {
      // Create hour window starting from current time minus i hours
      const hourStart = new Date(now);
      hourStart.setHours(now.getHours() - i, 0, 0, 0); // Set to exact hour, 0 minutes/seconds
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      const hourStr = hourStart.getHours().toString().padStart(2, '0') + ":00";

      const matchingEvents = events.filter(event => {
        const eventTime = new Date(event.timestamp);

        // Simple approach: check if the event hour matches this hour window
        // Use getHours() which automatically uses local timezone
        const eventHour = eventTime.getHours();
        const windowHour = hourStart.getHours();

        // Also check if it's the same day (to handle events from yesterday)
        const eventDay = eventTime.getDate();
        const windowDay = hourStart.getDate();

        const matches = eventHour === windowHour && eventDay === windowDay;

        // Debug log for hours around the current time (including current hour i=0)
        if (events.length > 0 && i <= 2) {
          console.log(`[Timeline Debug] Hour ${hourStr} (i=${i}):`, {
            windowHour,
            windowDay,
            eventHour,
            eventDay,
            matches,
            eventTime: eventTime.toLocaleString(),
            windowTime: hourStart.toLocaleString(),
            currentTime: now.toLocaleString()
          });
        }

        return matches;
      });

      hours.push({ label: i % 4 === 0 ? hourStr : "", value: matchingEvents.length });
    }

    return hours;
  }, [events]);

  return (
    <div className={className}>
      <h4 className="text-sm font-semibold mb-2 text-white">Activity (Last 24 Hours)</h4>
      <SimpleBarChart
        data={hourlyData.map(item => ({
          ...item,
          color: color
        }))}
        height={120}
        className="bg-black/20 rounded p-2"
      />
    </div>
  );
}