"use client";

import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export default function GpsMap({ data }: { data: any[] }) {
  // Filter for valid GPS data
  const validData = data.filter(d => d.lat != null && d.lng != null);

  if (!validData.length) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 rounded-lg text-gray-400">
        Waiting for GPS lock...
      </div>
    );
  }

  // Create the coordinate array for the path line
  const positions: [number, number][] = validData.map(p => [p.lat, p.lng]);
  const latestPos = positions[positions.length - 1];

  return (
    <div className="h-full w-full relative z-0">
      <MapContainer 
        center={latestPos} 
        zoom={18} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}
      >
        {/* SATELLITE VIEW: Using ESRI World Imagery */}
        <TileLayer
          attribution='Offline Maps'
          url="/data/tiles/{z}/{x}/{y}.jpg"
          maxZoom={13}
        />
        
        {/* The historical path line */}
        <Polyline positions={positions} color="#60a5fa" weight={3} opacity={0.6} />
        
        {/* PLOT ALL POSITIONS: Mapping every point to a small dot */}
        {validData.map((point, idx) => (
          <CircleMarker 
            key={idx}
            center={[point.lat, point.lng]} 
            radius={3} 
            pathOptions={{ 
              color: '#ffffff', 
              fillColor: '#3b82f6', 
              fillOpacity: 0.8,
              weight: 6 
            }}
          />
        ))}

        {/* Highlight the LATEST position with a larger pulse marker */}
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
            Latest: {latestPos[0].toFixed(4)}, {latestPos[1].toFixed(4)}
          </Tooltip>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}