"use client";

import { useEffect, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/telemetry', { cache: 'no-store' });
        if (res.ok) {
          const jsonData = await res.json();
          setData(jsonData);
        }
      } catch (error) {
        console.error('Failed to fetch telemetry data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);

    return () => clearInterval(interval);
  }, []);

  const activeData = scrubIndex !== null && data.length > 0 ? data.slice(0, scrubIndex + 1) : data;
  
  const validTimestamps = activeData.filter((row: any) => row.timestamp);
  const latestTimestamp = validTimestamps.length > 0 ? validTimestamps[validTimestamps.length - 1].timestamp : null;

  const validImages = activeData.filter((row: any) => row.image_name);
  const latestImage = validImages.length > 0 ? validImages[validImages.length - 1].image_name : null;
  const latestImageSrc = latestImage
    ? `/data/images/${latestImage}?t=${latestTimestamp ?? data.length}`
    : null;

  return (
    <main className="p-8 min-h-screen bg-slate-950 text-slate-100 font-sans">
      <h1 className="text-3xl font-bold mb-6 text-center text-white">Telemetry Dashboard</h1>
      
      {data.length > 0 && (
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl mb-8 flex items-center gap-4">
          <button 
             onClick={() => setScrubIndex(null)}
             className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${scrubIndex === null ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            Live
          </button>
          <input 
            type="range" 
            min="0" 
            max={data.length - 1} 
            value={scrubIndex !== null ? scrubIndex : data.length - 1}
            onChange={(e) => setScrubIndex(parseInt(e.target.value))}
            className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="text-slate-300 min-w-[120px] text-right font-mono text-sm bg-slate-950 py-2 px-3 rounded border border-slate-800">
            {formatTimestamp(latestTimestamp)}
          </div>
        </div>
      )}
      
      {latestTimestamp !== null && (
        <TelemetryStats data={activeData} latestTimestamp={latestTimestamp} isLive={scrubIndex === null} />
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Latest Image Display */}
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl flex flex-col items-center justify-center">
          <h2 className="text-xl font-semibold mb-4">Most Recent Transmission</h2>
          {latestImageSrc ? (
            <img 
              src={latestImageSrc} 
              alt="Latest Telemetry" 
              className="max-h-[400px] object-contain rounded-lg shadow-sm border border-slate-700"
            />
          ) : (
            <p className="text-slate-500">No image available</p>
          )}
        </div>

        {/* Interactive Leaflet Map Overlay */}
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl min-w-0">
          <h2 className="text-xl font-semibold mb-4">GPS Trajectory Map</h2>
          <div className="h-[400px] w-full z-0 relative rounded-lg overflow-hidden border border-slate-700">
            <DynamicMap data={activeData} />
          </div>
        </div>
      </div>

      {/* Telemetry Line Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <PlotlyTemperature data={activeData} />

        <ChartCard title="Altitude" data={activeData}>
          <Line type="monotone" dataKey="alt" stroke="#a855f7" name="Altitude" dot={false} />
        </ChartCard>

        <ChartCard title="RAM Usage (MB)" data={activeData}>
          <Line type="monotone" dataKey="ram" stroke="#22d3ee" name="RAM" dot={false} />
        </ChartCard>

        <ChartCard title="Battery Voltage (V)" data={activeData}>
          <Line type="monotone" dataKey="batt_v" stroke="#10b981" name="Voltage" dot={false} />
        </ChartCard>
      </div>
    </main>
  );
}

function ChartCard({ title, data, children }: { title: string, data: any[], children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl min-w-0"> 
      <h2 className="text-lg font-semibold mb-4 text-slate-200">{title}</h2>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data}>
            {/* Grid lines set to a subtle slate color */}
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
}