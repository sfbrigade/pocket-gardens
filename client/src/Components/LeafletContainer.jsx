import { useEffect, useRef, useState } from 'react';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { MapContainer } from 'react-leaflet/MapContainer';
import { TileLayer } from 'react-leaflet/TileLayer';
import { Marker } from 'react-leaflet/Marker';
import { Popup } from 'react-leaflet/Popup';
import { useMapEvents } from 'react-leaflet/hooks';
import { DomEvent, Icon, latLngBounds } from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';

import { plotsQueryOptions, plotStageLabel } from '../plots';

const SAN_FRANCISCO_BOUNDS = [[37.708, -122.515], [37.833, -122.355]];

const gardenIcon = new Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function PlotMarkers ({ selectedPlot, onSelectPlot }) {
  const [bounds, setBounds] = useState(null);
  const map = useMapEvents({ moveend: updateBounds, resize: updateBounds });

  function updateBounds () {
    const visible = map.getBounds();
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

  const visiblePlots = selectedPlot && Number.isFinite(selectedPlot.Latitude) && !plots.some(({ id }) => id === selectedPlot.id)
    ? [...plots, selectedPlot]
    : plots;
  return (
    <>
      {visiblePlots.map((plot) => (
        <Marker
          key={plot.id}
          position={[plot.Latitude, plot.Longitude]}
          icon={gardenIcon}
          title={plot['Pocket Garden Name'] || 'Pocket garden'}
          alt={plot['Pocket Garden Name'] || 'Pocket garden'}
        >
          <Popup>
            <strong>{plot['Pocket Garden Name'] || 'Pocket garden'}</strong>
            <div>Stage: {plotStageLabel(plot.stage)}</div>
            {onSelectPlot && <Button size='compact-sm' mt='xs' onClick={() => onSelectPlot(plot.id)}>View garden details</Button>}
          </Popup>
        </Marker>
      ))}
      <div role='status' aria-live='polite' className='map-status' hidden={!status}>{status}</div>
    </>
  );
}

function MapSelection ({ position, onPositionChange, selectedPlot, mode, viewportSize }) {
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const controls = useRef(null);
  const map = useMapEvents({
    click: ({ latlng }) => {
      if (mode === 'pick' && latLngBounds(SAN_FRANCISCO_BOUNDS).contains(latlng)) onPositionChange?.({ latitude: latlng.lat, longitude: latlng.lng });
    },
    locationfound: ({ latlng, accuracy }) => {
      setLocating(false);
      if (!latLngBounds(SAN_FRANCISCO_BOUNDS).contains(latlng)) { setMessage('Your location is outside this map. Choose a point on the map instead.'); return; }
      setMessage(`Location found, accurate to about ${Math.round(accuracy)} metres.`);
      map.setView(latlng, 17);
      if (mode === 'pick') onPositionChange?.({ latitude: latlng.lat, longitude: latlng.lng, accuracy });
    },
    locationerror: () => { setLocating(false); setMessage('Could not use your location. Check location access or choose a point on the map.'); },
  });
  useEffect(() => {
    if (controls.current) { DomEvent.disableClickPropagation(controls.current); DomEvent.disableScrollPropagation(controls.current); }
  }, []);
  useEffect(() => {
    const point = position ? [position.latitude, position.longitude] : selectedPlot ? [selectedPlot.Latitude, selectedPlot.Longitude] : null;
    if (point && point.every(Number.isFinite) && latLngBounds(SAN_FRANCISCO_BOUNDS).contains(point)) map.setView(point, 17);
  }, [map, position?.latitude, position?.longitude, selectedPlot?.id]);
  useEffect(() => {
    map.invalidateSize();
  }, [map, viewportSize?.width, viewportSize?.height]);
  useEffect(() => () => map.stopLocate(), [map]);
  return (
    <>
      <Paper ref={controls} p='xs' shadow='sm' style={{ position: 'absolute', right: 12, top: 12, zIndex: 1000, maxWidth: 260 }}>
        <Stack gap='xs'>
          <Button size='compact-md' loading={locating} variant='light' onClick={() => { setLocating(true); setMessage('Finding your location…'); map.locate({ enableHighAccuracy: true, timeout: 10000 }); }}>Use my location</Button>
          {mode === 'pick' && <Text size='sm'>Tap the map to place a pin. Drag the pin to adjust it.</Text>}
          {message && <Text size='sm' role='status'>{message}</Text>}
        </Stack>
      </Paper>
      {position && <Marker
        position={[position.latitude, position.longitude]} icon={gardenIcon} draggable title='New garden location' eventHandlers={{
          dragend: ({ target }) => {
            const point = target.getLatLng();
            if (latLngBounds(SAN_FRANCISCO_BOUNDS).contains(point)) onPositionChange?.({ latitude: point.lat, longitude: point.lng });
            else { target.setLatLng([position.latitude, position.longitude]); setMessage('Keep the pin within this map’s coverage.'); }
          }
        }}
                   />}
    </>
  );
}

function LeafletContainer ({ mode = 'explore', position, onPositionChange, selectedPlot, onSelectPlot, viewportSize }) {
  return (
    <MapContainer
      center={[37.7749, -122.4194]}
      zoom={13}
      minZoom={13}
      maxBounds={SAN_FRANCISCO_BOUNDS}
      maxBoundsViscosity={1}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      />
      <PlotMarkers selectedPlot={selectedPlot} onSelectPlot={onSelectPlot} />
      <MapSelection mode={mode} position={position} onPositionChange={onPositionChange} selectedPlot={selectedPlot} viewportSize={viewportSize} />
    </MapContainer>
  );
}

export default LeafletContainer;
