"use client";

import dynamic from 'next/dynamic';

// Dynamically import Plotly since it requires the window object
const Plot = dynamic(() => import('react-plotly.js'), { 
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse bg-slate-900 rounded-lg flex items-center justify-center text-slate-500">
      Loading Plotly Engine...
    </div>
  )
});

export default function PlotlyTemperature({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null;

  const timestamps = data.map((d) => {
    const t = d.timestamp < 20000000000 ? d.timestamp : d.timestamp / 1000;
    return new Date(t * 1000);
  });

  const plaTemps = data.map((d) => d.pla_temp);
  const foamPlaTemps = data.map((d) => d.foam_pla_temp);
  const outTemps = data.map((d) => d.out_temp);
  const mcuTemps = data.map((d) => d.mcu_temp);

  const layout = {
    title: false,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: {
      color: '#94a3b8',
      size: 10
    },
    xaxis: {
      gridcolor: '#334155',
      tickcolor: '#475569',
      type: 'date'
    },
    yaxis: {
      gridcolor: '#334155',
      tickcolor: '#475569',
      title: '°C'
    },
    margin: { l: 40, r: 20, t: 20, b: 40 },
    legend: {
      orientation: 'h' as const,
      y: -0.2
    },
    autosize: true,
    uirevision: 'true'
  };

  const config = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false
  };

  return (
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl min-w-0 flex flex-col w-full h-80 lg:col-span-2 xl:col-span-4">
      <h2 className="text-lg font-semibold mb-4 text-slate-200">Internal Temperatures (°C)</h2>
      <div className="flex-1 w-full h-full relative">
        <Plot
          data={[
            {
              x: timestamps,
              y: plaTemps,
              type: 'scattergl',
              mode: 'lines+markers',
              name: 'PLA Temp',
              line: { color: '#ec4899', width: 2 }, 
              marker: { size: 4 }
            },
            {
              x: timestamps,
              y: foamPlaTemps,
              type: 'scattergl',
              mode: 'lines+markers',
              name: 'Foaming PLA Temp',
              line: { color: '#8b5cf6', width: 2 }, 
              marker: { size: 4 }
            },
            {
              x: timestamps,
              y: outTemps,
              type: 'scattergl',
              mode: 'lines',
              name: 'Outside',
              line: { color: '#3b82f6', width: 1, dash: 'dot' }
            },
            {
              x: timestamps,
              y: mcuTemps,
              type: 'scattergl',
              mode: 'lines',
              name: 'MCU',
              line: { color: '#ef4444', width: 1, dash: 'dot' }
            }
          ]}
          layout={layout as any}
          config={config}
          useResizeHandler={true}
          style={{ width: '100%', height: '100%', position: 'absolute' }}
        />
      </div>
    </div>
  );
}