import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer } from 'react-leaflet/MapContainer';
import { TileLayer } from 'react-leaflet/TileLayer';
import { Marker } from 'react-leaflet/Marker';
import { useMapEvents } from 'react-leaflet/hooks';
import { Icon } from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';

import { plotsQueryOptions } from '../plots';

// Explicit imports let Vite resolve the marker images in development and production.
const gardenIcon = new Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
});

function PlotMarkers () {
  const [bounds, setBounds] = useState(null);
  const map = useMapEvents({ moveend: updateBounds, resize: updateBounds });

  function updateBounds () {
    const visible = map.getBounds();
    // ponytail: query one world; split bounds if antimeridian coverage is needed.
    setBounds({
      north: Math.min(90, visible.getNorth()),
      south: Math.max(-90, visible.getSouth()),
      east: Math.max(-180, Math.min(180, visible.getEast())),
      west: Math.max(-180, Math.min(180, visible.getWest())),
    });
  }

  useEffect(() => {
    map.whenReady(updateBounds);
  }, [map]);

  const { data: plots = [], isPending, isFetching, isError } = useQuery(plotsQueryOptions(bounds));
  const status = isError
    ? 'Unable to load gardens. Please try again by moving the map.'
    : isPending || isFetching
      ? 'Loading gardens…'
      : plots.length === 0 ? 'No gardens in this area.' : '';

  return (
    <>
      {plots.map((plot) => (
        <Marker
          key={plot.id}
          position={[plot.Latitude, plot.Longitude]}
          icon={gardenIcon}
          title={plot['Pocket Garden Name'] || 'Pocket garden'}
          alt={plot['Pocket Garden Name'] || 'Pocket garden'}
        />
      ))}
      <div role='status' aria-live='polite' className='map-status' hidden={!status}>{status}</div>
    </>
  );
}

function LeafletContainer () {
  return (
    <MapContainer center={[37.7749, -122.4194]} zoom={13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      />
      <PlotMarkers />
    </MapContainer>
  );
}

export default LeafletContainer;
