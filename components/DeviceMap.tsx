"use client";

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Layers, Map, Satellite, Mountain, Palette, Globe, Target, Plus, Minus } from 'lucide-react';

type MapMode = 'streets' | 'satellite' | 'terrain' | 'grayscale' | 'atlas' | 'outdoor';

export default function DeviceMap({ latitude, longitude, cityName }: any) {
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [currentMode, setCurrentMode] = useState<MapMode>('streets');

  const tileProviders = {
    streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    terrain: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    grayscale: 'https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png',
    atlas: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    outdoor: 'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png'
  };

  useEffect(() => {
    import('leaflet').then((L) => {
      if (!mapContainerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current, { attributionControl: false, zoomControl: false }).setView([latitude ?? 24.8607, longitude ?? 67.0011], 13);
        const icon = L.divIcon({ className: 'custom-pin', html: `<div class="w-5 h-5 bg-emerald-600 border-2 border-white rounded-full shadow-lg"></div>` });
        L.marker([latitude ?? 24.8607, longitude ?? 67.0011], { icon }).addTo(mapRef.current).bindPopup(cityName || "Device Location");
      }
      if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
      tileLayerRef.current = L.tileLayer(tileProviders[currentMode]).addTo(mapRef.current);
    });
  }, [currentMode]);

  const modes: { id: MapMode; label: string; icon: any }[] = [
    { id: 'streets', label: 'Streets', icon: Map },
    { id: 'satellite', label: 'Satellite', icon: Satellite },
    { id: 'terrain', label: 'Terrain', icon: Mountain },
    { id: 'grayscale', label: 'Mono', icon: Palette },
    { id: 'atlas', label: 'Atlas', icon: Globe },
    { id: 'outdoor', label: 'Outdoor', icon: Target },
  ];

  return (
    <div className="relative w-full h-[500px] rounded-2xl overflow-hidden border border-slate-200 shadow-xl bg-white flex">

      {/* Vertical Sidebar */}
      <div className="w-16 bg-slate-50 border-r scrool border-slate-200 flex flex-col items-center py-4 gap-4 z-[1000]">
        <div className="text-emerald-600 mb-2"><Layers size={24} /></div>

        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setCurrentMode(m.id)}
            title={m.label}
            className={`p-3 rounded-xl transition-all ${currentMode === m.id ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}
          >
            <m.icon size={20} />
          </button>
        ))}

        <div className="mt-auto flex flex-col gap-2 border-t border-slate-200 pt-4">
          <button onClick={() => mapRef.current?.zoomIn()} className="p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-100"><Plus size={20} /></button>
          <button onClick={() => mapRef.current?.zoomOut()} className="p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-100"><Minus size={20} /></button>
        </div>
      </div>

      {/* Map Area */}
      <div ref={mapContainerRef} className="flex-1 h-full" />
    </div>
  );
}