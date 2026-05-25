"use client";

import { useEffect, useRef, useState } from "react";

export default function TelemetryStats({ data, latestTimestamp, isLive = true }: { data: any[], latestTimestamp: number, isLive?: boolean }) {
  const [, setTick] = useState(0);
  const firstPacketTimestampRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isLive) setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  if (firstPacketTimestampRef.current === null && data.length > 0 && typeof data[0].timestamp === "number") {
    firstPacketTimestampRef.current = data[0].timestamp;
  }

  const firstPacketTimestamp = firstPacketTimestampRef.current;

  if (!data.length || firstPacketTimestamp === null) return null;

  const current = data.find(d => d.timestamp === latestTimestamp) || data[data.length - 1];

  const playbackDurationSeconds = Math.max(0, latestTimestamp - firstPacketTimestamp);
  const liveDurationSeconds = Math.max(0, Math.floor(Date.now() / 1000) - firstPacketTimestamp);
  const tPlusTotalSeconds = isLive ? liveDurationSeconds : playbackDurationSeconds;

  const h = Math.floor(tPlusTotalSeconds / 3600);
  const m = Math.floor((tPlusTotalSeconds % 3600) / 60);
  const s = Math.floor(tPlusTotalSeconds % 60);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-gray-900 p-4 border-l-4 border-blue-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Climb Rate</p>
        <p className="text-2xl font-mono text-purple-400">
          {current.climb_rate >= 0 ? "+" : ""}{current.climb_rate} m/s
        </p>
      </div>

      <div className="bg-gray-900 p-4 border-l-4 border-green-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Altitude</p>
        <p className="text-2xl font-mono text-purple-400">{current.alt.toFixed(1)} m</p>
      </div>

      <div className="bg-gray-900 p-4 border-l-4 border-purple-500">
        <p className="text-gray-500 text-xs font-bold uppercase">{isLive ? 'T-Plus (Live)' : 'T-Plus (Playback)'}</p>
        <p className="text-2xl font-mono text-purple-400">
          {h > 0 ? `${h}h ` : ''}{m}m {s.toString().padStart(2, '0')}s
        </p>
      </div>

      <div className="bg-gray-900 p-4 border-l-4 border-yellow-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Satellites</p>
        <p className="text-2xl font-mono text-purple-400">{current.satellite_fixes}</p>
      </div>
    </div>
  );
}
