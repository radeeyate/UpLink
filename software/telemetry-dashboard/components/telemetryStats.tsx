"use client";

import { useEffect, useRef, useState } from "react";

interface TelemetryStatsProps {
  data: any[];
  targetIndex: number;
  isLive?: boolean;
}

export default function TelemetryStats({ data, targetIndex, isLive = true }: TelemetryStatsProps) {
  const [, setTick] = useState(0);
  const firstPacketTimestampRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isLive) setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  const cutoffTimestamp = Date.UTC(2026, 0, 1) / 1000;
  const validTPlusData = data.filter((d: any) => {
    if (typeof d.timestamp !== "number") return false;
    const ts = d.timestamp > 20000000000 ? d.timestamp / 1000 : d.timestamp;
    return ts >= cutoffTimestamp;
  });

  if (firstPacketTimestampRef.current === null && validTPlusData.length > 0 && typeof validTPlusData[0].timestamp === "number") {
    const raw = validTPlusData[0].timestamp;
    firstPacketTimestampRef.current = raw > 20000000000 ? raw / 1000 : raw;
  }

  const firstPacketTimestamp = firstPacketTimestampRef.current;

  if (!data.length) return null;

  const current = data[targetIndex] || data[data.length - 1];
  if (!current) return null;

  const latestTimestamp = current.timestamp;
  const playbackDurationSeconds = Math.max(0, latestTimestamp - firstPacketTimestamp);
  const liveDurationSeconds = Math.max(0, Math.floor(Date.now() / 1000) - firstPacketTimestamp);
  const tPlusTotalSeconds = isLive ? liveDurationSeconds : playbackDurationSeconds;

  const h = Math.floor(tPlusTotalSeconds / 3600);
  const m = Math.floor((tPlusTotalSeconds % 3600) / 60);
  const s = Math.floor(tPlusTotalSeconds % 60);

  const sysOkClass = (ok: boolean) =>
    ok ? "text-green-400" : "text-red-400";

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
        <div className="bg-gray-900 p-4 border-l-4 border-blue-500">
          <p className="text-gray-500 text-xs font-bold uppercase">Climb Rate</p>
          <p className="text-2xl font-mono text-purple-400">
            {current.climb_rate >= 0 ? "+" : ""}{current.climb_rate} m/s
          </p>
        </div>

        <div className="bg-gray-900 p-4 border-l-4 border-green-500">
          <p className="text-gray-500 text-xs font-bold uppercase">Altitude</p>
          <p className="text-2xl font-mono text-purple-400">{current.alt?.toFixed(1) ?? "0.0"} m</p>
        </div>

        <div className="bg-gray-900 p-4 border-l-4 border-purple-500">
          <p className="text-gray-500 text-xs font-bold uppercase">{isLive ? 'T-Plus (Live)' : 'T-Plus (Playback)'}</p>
          <p className="text-2xl font-mono text-purple-400">
            {h > 0 ? `${h}h ` : ''}{m}m {s.toString().padStart(2, '0')}s
          </p>
        </div>

        <div className="bg-gray-900 p-4 border-l-4 border-yellow-500">
          <p className="text-gray-500 text-xs font-bold uppercase">Satellites</p>
          <p className="text-2xl font-mono text-purple-400">{current.satellite_fixes ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className={`bg-gray-900 p-4 border-l-4 ${current.sd_card_ok ? 'border-green-500' : 'border-red-500'}`}>
          <p className="text-gray-500 text-xs font-bold uppercase">SD Card</p>
          <p className={`text-2xl font-mono ${sysOkClass(current.sd_card_ok)}`}>
            {current.sd_card_ok ? "OK" : "FAIL"}
          </p>
        </div>

        <div className={`bg-gray-900 p-4 border-l-4 ${current.camera_ok ? 'border-green-500' : 'border-red-500'}`}>
          <p className="text-gray-500 text-xs font-bold uppercase">Camera</p>
          <p className={`text-2xl font-mono ${sysOkClass(current.camera_ok)}`}>
            {current.camera_ok ? "OK" : "FAIL"}
          </p>
        </div>

        <div className={`bg-gray-900 p-4 border-l-4 ${current.gps_fix_ok ? 'border-green-500' : 'border-red-500'}`}>
          <p className="text-gray-500 text-xs font-bold uppercase">GPS Fix</p>
          <p className={`text-2xl font-mono ${sysOkClass(current.gps_fix_ok)}`}>
            {current.gps_fix_ok ? "FIX" : "NO FIX"}
          </p>
        </div>
      </div>
    </>
  );
}