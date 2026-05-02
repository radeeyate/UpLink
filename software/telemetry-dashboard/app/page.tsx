"use client";

import { useEffect, useState } from 'react';
import { 
  LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

import dynamic from 'next/dynamic'; // Required to prevent Leaflet SSR crashes
import { formatTimestamp } from '../utils/dateUtils'; 


const DynamicMap = dynamic(() => import('../components/GpsMap'), { 
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-gray-200 rounded-lg flex items-center justify-center text-gray-400">Loading Map Engine...</div>
});

export default function Dashboard() {
  const [data, setData] = useState<any[]>([]);
  const [latestImage, setLatestImage] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch('/api/telemetry');
      if (res.ok) {
        const jsonData = await res.json();
        setData(jsonData);
        
        // Find the most recent image based on the last row in the CSV
        const validImages = jsonData.filter((row: any) => row.image_name);
        if (validImages.length > 0) {
          setLatestImage(validImages[validImages.length - 1].image_name);
        }
      }
    };

    fetchData();
  }, []);


  return (
    <main className="p-8 min-h-screen bg-gray-50 text-gray-900 font-sans">
      <h1 className="text-3xl font-bold mb-8 text-center">Telemetry Dashboard</h1>
      

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        
        {/* Latest Image Display */}
        <div className="bg-white p-4 rounded-xl shadow-md flex flex-col items-center justify-center">
          <h2 className="text-xl font-semibold mb-4">Most Recent Transmission</h2>
          {latestImage ? (
            <img 
              src={`/data/images/${latestImage}`} 
              alt="Latest Telemetry" 
              className="max-h-[400px] object-contain rounded-lg shadow-sm"
            />
          ) : (
            <p className="text-gray-500">No image available</p>
          )}
        </div>

        {/*Interactive Leaflet Map Overlay */}
        <div className="bg-white p-4 rounded-xl shadow-md min-w-0">
          <h2 className="text-xl font-semibold mb-4">GPS Trajectory Map</h2>
          <div className="h-[400px] w-full z-0 relative">
            <DynamicMap data={data} />
          </div>
        </div>

      </div>

      {/* Telemetry Line Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        
        {/* Temperatures */}
        <ChartCard title="Temperatures (°C)" data={data}>
          <Line type="monotone" dataKey="out_temp" stroke="#3b82f6" name="Outside" />
          <Line type="monotone" dataKey="in_temp" stroke="#f59e0b" name="Inside" />
          <Line type="monotone" dataKey="mcu_temp" stroke="#ef4444" name="MCU" />
        </ChartCard>

        {/* Altitude */}
        <ChartCard title="Altitude" data={data}>
          <Line type="monotone" dataKey="alt" stroke="#8b5cf6" name="Altitude" />
        </ChartCard>

        {/* RAM Usage */}
        <ChartCard title="RAM Usage (MB)" data={data}>
          <Line type="monotone" dataKey="ram" stroke="#8b5cf6" name="RAM" />
        </ChartCard>

        {/* Battery Voltage */}
        <ChartCard title="Battery Voltage (V)" data={data}>
          <Line type="monotone" dataKey="batt_v" stroke="#10b981" name="Voltage" />
        </ChartCard>

      </div>
    </main>
  );
}

// Reusable Chart Component Wrapper
function ChartCard({ title, data, children }: { title: string, data: any[], children: React.ReactNode }) {
  return (
    // Added min-w-0 to prevent CSS Grid flex-shrink collapses
    <div className="bg-white p-4 rounded-xl shadow-md min-w-0"> 
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="h-48 w-full">
        {/* Added minWidth={0} directly to the component */}
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={formatTimestamp} type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10}} />
            <YAxis domain={['auto', 'auto']} />
            <Tooltip />
            <Legend />
            {children}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

