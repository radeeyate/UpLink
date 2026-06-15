"use client";

import React, { useEffect, useState, useRef, useMemo, useTransition } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { useDebounce } from 'use-debounce';
import Papa from 'papaparse';

import dynamic from 'next/dynamic';
import { formatTimestamp } from '../utils/dateUtils'; 
import TelemetryStats from '@/components/telemetryStats';
import PlotlyTemperature from '@/components/PlotlyTemperature';

const DynamicMap = dynamic(() => import('../components/GpsMap'), { 
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-900 rounded-lg flex items-center justify-center text-slate-500">Loading Map Engine...</div>
});

export default function Dashboard() {
  const [data, setData] = useState<any[]>([]);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  
  const sliderRef = useRef<HTMLInputElement>(null);

  const [, startTransition] = useTransition();
  const [debouncedScrubIndex] = useDebounce(scrubIndex, 10);

  useEffect(() => {
    const NUM_KEYS = ['lat', 'lng', 'alt', 'ground_speed', 'climb_rate', 'timestamp', 'satellite_fixes', 'mcu_temp', 'foam_pla_temp', 'pla_temp', 'out_temp', 'ram', 'batt_v', 'timestamp_received'];
    const BOOL_KEYS = ['sd_card_ok', 'camera_ok', 'gps_fix_ok'];

    const fetchData = async () => {
      try {
        const res = await fetch('/api/telemetry', { cache: 'no-store' });
        if (res.ok) {
          const csvText = await res.text();
          const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
          const records = (parsed.data as any[]).map((row: any) => {
            const obj: any = {};
            for (const key of Object.keys(row)) {
              const val = row[key];
              if (BOOL_KEYS.includes(key)) {
                obj[key] = val === "True";
              } else if (NUM_KEYS.includes(key) && typeof val === 'string' && val.trim() !== '') {
                obj[key] = Number(val);
              } else {
                obj[key] = val;
              }
            }
            return obj;
          });
          setData(records);
        }
      } catch (error) {
        console.error('Failed to fetch telemetry data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);

    return () => clearInterval(interval);
  }, []);

  const targetIndex = scrubIndex !== null ? scrubIndex : data.length - 1;
  const currentPacket = data.length > 0 ? data[targetIndex] : null;
  const latestTimestamp = currentPacket?.timestamp ?? null;

  let latestImageSrc = null;
  if (data.length > 0) {
    for (let i = targetIndex; i >= 0; i--) {
      if (data[i]?.image_name) {
        latestImageSrc = `/api/images/${data[i].image_name}?t=${latestTimestamp ?? data.length}`;
        break;
      }
    }
  }

  const cutoffTimestamp = Date.UTC(2026, 0, 1) / 1000;
  const heavyActiveData = useMemo(() => {
    let source = data;
    if (debouncedScrubIndex !== null && data.length > 0) {
      source = data.slice(0, debouncedScrubIndex + 1);
    }
    return source.filter((d: any) => {
      if (typeof d.timestamp !== "number") return false;
      const ts = d.timestamp > 20000000000 ? d.timestamp / 1000 : d.timestamp;
      return ts >= cutoffTimestamp;
    });
  }, [debouncedScrubIndex, data]);

  const memoizedMap = useMemo(() => (
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl min-w-0">
      <h2 className="text-xl font-semibold mb-4">GPS Trajectory Map</h2>
      <div className="h-[400px] w-full z-0 relative rounded-lg overflow-hidden border border-slate-700">
        <DynamicMap data={heavyActiveData} />
      </div>
    </div>
  ), [heavyActiveData]);

  const memoizedCharts = useMemo(() => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
      <PlotlyTemperature data={heavyActiveData} />

      <ChartCard title="Altitude" data={heavyActiveData}>
        <Line type="monotone" dataKey="alt" stroke="#a855f7" name="Altitude" dot={false} isAnimationActive={false} />
      </ChartCard>

      <ChartCard title="RAM Usage (MB)" data={heavyActiveData}>
        <Line type="monotone" dataKey="ram" stroke="#22d3ee" name="RAM" dot={false} isAnimationActive={false} />
      </ChartCard>

      <ChartCard title="Battery Voltage (V)" data={heavyActiveData}>
        <Line type="monotone" dataKey="batt_v" stroke="#10b981" name="Voltage" dot={false} isAnimationActive={false} />
      </ChartCard>
    </div>
  ), [heavyActiveData]);

  return (
    <main className="p-8 min-h-screen bg-slate-950 text-slate-100 font-sans">
      <h1 className="text-3xl font-bold mb-6 text-center text-white">Telemetry Dashboard</h1>
      
      {data.length > 0 && (
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl mb-8 flex items-center gap-4">
          <button 
             onClick={() => {
               setScrubIndex(null);
             }}
             className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${scrubIndex === null ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            Live
          </button>
          
          <input 
            ref={sliderRef}
            type="range" 
            min="0" 
            max={Math.max(0, data.length - 1)} 
            value={scrubIndex !== null ? scrubIndex : Math.max(0, data.length - 1)}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              startTransition(() => {
                setScrubIndex(val);
              });
            }}
            className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          
          <div className="text-slate-300 min-w-[120px] text-right font-mono text-sm bg-slate-950 py-2 px-3 rounded border border-slate-800">
            {formatTimestamp(latestTimestamp)}
          </div>
        </div>
      )}
      
      {latestTimestamp !== null && data.length > 0 && (
        <TelemetryStats data={data} targetIndex={targetIndex} isLive={scrubIndex === null} />
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl flex flex-col items-center justify-center">
          <h2 className="text-xl font-semibold mb-4">Most Recent Transmission</h2>
          {latestImageSrc ? (
            <img 
              src={latestImageSrc} 
              alt="Latest Telemetry" 
              className="max-h-[520px] object-contain rounded-lg shadow-sm border border-slate-700"
            />
          ) : (
            <p className="text-slate-500">No image available</p>
          )}
        </div>

        {memoizedMap}
      </div>

      {memoizedCharts}
    </main>
  );
}

const ChartCard = React.memo(function ChartCard({ title, data, children }: { title: string, data: any[], children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl min-w-0"> 
      <h2 className="text-lg font-semibold mb-4 text-slate-200">{title}</h2>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={formatTimestamp} 
              type="number" 
              domain={['dataMin', 'dataMax']} 
              tick={{ fontSize: 10, fill: '#94a3b8' }} 
              stroke="#475569"
            />
            <YAxis 
              domain={['auto', 'auto']} 
              tick={{ fontSize: 10, fill: '#94a3b8' }} 
              stroke="#475569"
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
              itemStyle={{ fontSize: '12px' }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
            {children}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});