"use client";

import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { formatTimestamp } from '../utils/dateUtils'; 

function RecenterButton({ center }: { center: [number, number] }) {
  const map = useMap();
  return (
    <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 1000 }}>
      <button 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          map.flyTo(center, Math.max(map.getZoom(), 15));
        }}
        className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-1.5 px-3 rounded shadow-lg border border-blue-700 transition-colors pointer-events-auto"
      >
        Go to Last Point
      </button>
    </div>
  );
}

export default function GpsMap({ data }: { data: any[] }) {
  // Filter for valid GPS data
  const validData = data.filter(d => d.gps_fix_ok === true);

  if (!validData.length) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 rounded-lg text-gray-400">
        Waiting for GPS
      </div>
    );
  }

  // Create the coordinate array for the path line
  const positions: [number, number][] = validData.map(p => [p.lat, p.lng]);
  const latestPos = positions[positions.length - 1];
  const timestamps = validData.map(t => t.timestamp);
  const latestTimestamp = timestamps[timestamps.length - 1];

  return (
    <div className="h-full w-full relative z-0">
      <MapContainer 
        center={latestPos} 
        zoom={18} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}
      >
        <RecenterButton center={latestPos} />
        {/* Online Maps: OpenStreetMap */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <Polyline positions={positions} color="#60a5fa" weight={3} opacity={0.6} />

        <CircleMarker 
          center={latestPos} 
          radius={8} 
          pathOptions={{ 
            color: '#ffffff', 
            fillColor: '#ef4444', 
            fillOpacity: 1,
            weight: 2 
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} opacity={1} permanent>
            <div style={{ textAlign: 'center' }}>
              <div>{latestPos[0].toFixed(4)}, {latestPos[1].toFixed(4)}</div>
              <div>Time: {formatTimestamp(latestTimestamp)}</div>
              <div>Satellites: {validData[validData.length - 1].satellite_fixes}</div>
              <div>Climb Rate: {validData[validData.length - 1].climb_rate} m/s</div>
            </div>
          </Tooltip>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}