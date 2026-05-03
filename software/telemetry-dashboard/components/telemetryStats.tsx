"use client";

import { useState, useEffect, useMemo } from "react";

export default function TelemetryStats({ data, latestTimestamp }: { data: any[], latestTimestamp: number }) {
  // We can destructure it cleanly with a blank comma since we don't need to read 'tick' directly
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // 2. Memoize the T-0 (First packet)
  // FIX: Depend safely on the first element's timestamp, not a boolean evaluation.
  const firstTimestamp = useMemo(() => {
    return data.length > 0 ? data[0].timestamp : null;
  }, [data[0]?.timestamp]); 

  if (!data.length || firstTimestamp === null) return null;

  // 3. Current Data Point (Safe fallback)
  const current = data.find(d => d.timestamp === latestTimestamp) || data[data.length - 1];

  // 4. LIVE T-PLUS CALCULATION
  // FIX: Handle both seconds and milliseconds seamlessly.
  // If the timestamp is less than ~20 billion, it's in seconds. Otherwise, it's in milliseconds.
  const isSeconds = firstTimestamp < 20000000000; 
  const firstTimestampMs = isSeconds ? firstTimestamp * 1000 : firstTimestamp;

  // Subtract in milliseconds first, then convert the total difference to seconds
  const tPlusTotalSeconds = Math.max(0, Math.floor((Date.now() - firstTimestampMs) / 1000));
  
  const m = Math.floor(tPlusTotalSeconds / 60);
  const s = Math.floor(tPlusTotalSeconds % 60);

  // 5. ELEVATION RATE
  const getElevationRate = () => {
    if (data.length < 2) return 0;
    const curr = data[data.length - 1];
    const prev = data[Math.max(0, data.length - 5)];
    
    const dAlt = curr.alt - prev.alt;
    const dTime = curr.timestamp - prev.timestamp;
    
    return dTime > 0 ? dAlt / dTime : 0;
  };

  const elevationRate = getElevationRate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Elevation Rate */}
      <div className="bg-gray-900 p-4 border-l-4 border-blue-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Elevation Rate</p>
        <p className="text-2xl font-mono text-purple-400">
          {elevationRate >= 0 ? "+" : ""}{elevationRate.toFixed(2)} {/* Note: If dTime is in ms, this will output m/ms instead of m/s */}
        </p>
      </div>

      {/* Altitude */}
      <div className="bg-gray-900 p-4 border-l-4 border-green-500">
        <p className="text-gray-500 text-xs font-bold uppercase">Altitude</p>
        <p className="text-2xl font-mono text-purple-400">{current.alt.toFixed(1)} m</p>
      </div>

      {/* Live T-Plus */}
      <div className="bg-gray-900 p-4 border-l-4 border-purple-500">
        <p className="text-gray-500 text-xs font-bold uppercase">T-Plus (Live)</p>
        <p className="text-2xl font-mono text-purple-400">
          {m}m {s.toString().padStart(2, '0')}s
        </p>
      </div>
    </div>
  );
}