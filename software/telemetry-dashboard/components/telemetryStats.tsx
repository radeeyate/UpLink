"use client";

import { useState, useEffect, useMemo } from "react";

export default function TelemetryStats({ data, latestTimestamp, isLive = true }: { data: any[], latestTimestamp: number, isLive?: boolean }) {
  const [, setTick] = useState(0);
  const [localTimeAtLastPacket, setLocalTimeAtLastPacket] = useState<number>(Date.now());
  const [lastLatestTimestamp, setLastLatestTimestamp] = useState<number>(latestTimestamp);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isLive) setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  useEffect(() => {
    if (latestTimestamp !== lastLatestTimestamp) {
      setLocalTimeAtLastPacket(Date.now());
      setLastLatestTimestamp(latestTimestamp);
    }
  }, [latestTimestamp, lastLatestTimestamp]);

  const firstTimestamp = useMemo(() => {
    return data.length > 0 ? data[0].timestamp : null;
  }, [data[0]?.timestamp]); 

  if (!data.length || firstTimestamp === null) return null;

  const current = data.find(d => d.timestamp === latestTimestamp) || data[data.length - 1];

  const isSeconds = firstTimestamp < 20000000000;
  const firstTimeSec = isSeconds ? firstTimestamp : Math.floor(firstTimestamp / 1000);
  const latestTimeSec = isSeconds ? latestTimestamp : Math.floor(latestTimestamp / 1000);
  
  const flightDurationSeconds = Math.max(0, latestTimeSec - firstTimeSec);
  const timeSinceLastPacketSeconds = isLive ? Math.floor((Date.now() - localTimeAtLastPacket) / 1000) : 0;
  const tPlusTotalSeconds = flightDurationSeconds + timeSinceLastPacketSeconds;
  
  const h = Math.floor(tPlusTotalSeconds / 3600);
  const m = Math.floor((tPlusTotalSeconds % 3600) / 60);
  const s = Math.floor(tPlusTotalSeconds % 60);

  const getElevationRate = () => {
    if (data.length < 2) return 0;
    const curr = data[data.length - 1];
    const prev = data[Math.max(0, data.length - 5)];
    
    const dAlt = curr.alt - prev.alt;
    const currTimeSec = curr.timestamp < 20000000000 ? curr.timestamp : curr.timestamp / 1000;
    const prevTimeSec = prev.timestamp < 20000000000 ? prev.timestamp : prev.timestamp / 1000;
    const dTime = currTimeSec - prevTimeSec;
    
    return dTime > 0 ? dAlt / dTime : 0;
  };

  const elevationRate = getElevationRate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Elevation Rate */}
      <div className="bg-gray-900 p-4 border-l-4 border-blue-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Elevation Rate</p>
        <p className="text-2xl font-mono text-purple-400">
          {elevationRate >= 0 ? "+" : ""}{elevationRate.toFixed(2)} m/s
        </p>
      </div>

      {/* Altitude */}
      <div className="bg-gray-900 p-4 border-l-4 border-green-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Altitude</p>
        <p className="text-2xl font-mono text-purple-400">{current.alt.toFixed(1)} m</p>
      </div>

      {/* Live T-Plus */}
      <div className="bg-gray-900 p-4 border-l-4 border-purple-500">
        <p className="text-gray-500 text-xs font-bold uppercase">{isLive ? 'T-Plus (Live)' : 'T-Plus (Playback)'}</p>
        <p className="text-2xl font-mono text-purple-400">
          {h > 0 ? `${h}h ` : ''}{m}m {s.toString().padStart(2, '0')}s
        </p>
      </div>
    </div>
  );
}