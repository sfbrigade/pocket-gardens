import { useEffect, useRef, useState } from 'react';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { MapContainer } from 'react-leaflet/MapContainer';
import { TileLayer } from 'react-leaflet/TileLayer';
import { Marker } from 'react-leaflet/Marker';
import { Popup } from 'react-leaflet/Popup';
import { useMapEvents } from 'react-leaflet/hooks';
import { DomEvent, Icon, latLng, latLngBounds } from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';

import { bufferedBounds, containsBounds, hasCoordinates, plotsQueryOptions, plotStageLabel } from '../plots';
import { isMapPosition, SAN_FRANCISCO_BOUNDS } from '../map-location';

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
  const timer = useRef(null);
  const refresh = useRef(null);
  const map = useMapEvents({ moveend: updateBounds, resize: updateBounds });
  // Only the current coverage is retained. Nearby checks keep their own exact queries.
  const { data: plots = [], isPending, isFetching, isError, isStale, refetch } = useQuery({ ...plotsQueryOptions(bounds), gcTime: 0 });

  function updateBounds () {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => refresh.current(), 250);
  }

  refresh.current = () => {
    const visible = map.getBounds();
    const next = {
      north: Math.min(90, visible.getNorth()),
      south: Math.max(-90, visible.getSouth()),
      east: Math.max(-180, Math.min(180, visible.getEast())),
      west: Math.max(-180, Math.min(180, visible.getWest())),
    };
    if (!Object.values(next).every(Number.isFinite) || next.north < next.south || next.east < next.west) return;
    if (containsBounds(bounds, next)) {
      if ((isError || isStale) && !isFetching) refetch();
    } else setBounds(bufferedBounds(next));
  };

  useEffect(() => {
    map.whenReady(updateBounds);
    return () => { clearTimeout(timer.current); map.off('load', updateBounds); };
  }, [map]);

  const status = isError
    ? 'Unable to load gardens. Please try again by moving the map.'
    : isPending || isFetching
      ? 'Loading gardens…'
      : plots.length === 0 ? 'No gardens in this area.' : '';

  const visiblePlots = selectedPlot && hasCoordinates(selectedPlot) && !plots.some(({ id }) => id === selectedPlot.id)
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

function NearbyGardens ({ position }) {
  const point = latLng(position.latitude, position.longitude);
  const area = point.toBounds(440);
  const bounds = { north: area.getNorth(), south: area.getSouth(), east: area.getEast(), west: area.getWest() };
  const query = useQuery(plotsQueryOptions(bounds));
  const nearby = (query.data ?? []).map((plot) => ({ plot, distance: point.distanceTo([plot.Latitude, plot.Longitude]) }))
    .filter(({ distance }) => distance <= 200).sort((a, b) => a.distance - b.distance);
  return (
    <Text size='sm' role='status'>{query.isError
      ? 'Could not check nearby gardens.'
      : query.isPending || query.isFetching
        ? 'Checking nearby gardens…'
        : nearby.length ? `${nearby.length} garden${nearby.length === 1 ? '' : 's'} within 200 m. Nearest: ${nearby[0].plot['Pocket Garden Name'] || 'Pocket garden'}, ${Math.round(nearby[0].distance)} m away.` : 'No other gardens recorded within 200 m.'}
    </Text>
  );
}

function MapSelection ({ position, onPositionChange, onCreatePlot, selectedPlot, mode, disabled, viewportSize }) {
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [nearbyPosition] = useDebouncedValue(position, 800);
  const controls = useRef(null);
  const map = useMapEvents({
    dblclick: ({ latlng, originalEvent }) => {
      // Markers stop bubbling in Leaflet; also exclude controls and popup content.
      if (originalEvent?.target?.closest?.('.leaflet-marker-icon, .leaflet-control, .leaflet-popup, .garden-map-controls')) return;
      const position = { latitude: latlng.lat, longitude: latlng.lng };
      if (mode === 'explore' && !disabled && isMapPosition(position)) onCreatePlot?.(position);
    },
    click: ({ latlng }) => {
      if (mode === 'pick' && !disabled && latLngBounds(SAN_FRANCISCO_BOUNDS).contains(latlng)) onPositionChange?.({ latitude: latlng.lat, longitude: latlng.lng });
    },
    locationfound: ({ latlng, accuracy }) => {
      setLocating(false);
      if (!latLngBounds(SAN_FRANCISCO_BOUNDS).contains(latlng)) { setMessage('Your location is outside this map. Choose a point on the map instead.'); return; }
      setMessage(`Location found, accurate to about ${Math.round(accuracy)} metres.`);
      map.setView(latlng, 17);
      if (mode === 'pick' && !disabled) onPositionChange?.({ latitude: latlng.lat, longitude: latlng.lng, accuracy });
    },
    locationerror: () => { setLocating(false); setMessage('Could not use your location. Check location access or choose a point on the map.'); },
  });
  useEffect(() => {
    // Reserve double-click for creation only when that shortcut is available.
    if (mode === 'explore' && onCreatePlot && !disabled) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [map, mode, onCreatePlot, disabled]);
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
      <Paper ref={controls} className='garden-map-controls' p='xs' shadow='sm' style={{ position: 'absolute', right: 12, top: 12, zIndex: 1000, maxWidth: 260 }}>
        <Stack gap='xs'>
          <Button size='compact-md' disabled={disabled} loading={locating} variant='light' onClick={() => { setLocating(true); setMessage('Finding your location…'); map.locate({ enableHighAccuracy: true, timeout: 10000 }); }}>Use my location</Button>
          {mode === 'explore' && onCreatePlot && <Text size='sm'>Double-click empty map space to start a garden here, or use Create a garden.</Text>}
          {mode === 'pick' && <><Button size='compact-md' disabled={disabled} variant='default' onClick={() => { const point = map.getCenter(); onPositionChange?.({ latitude: point.lat, longitude: point.lng }); }}>Place pin at map center</Button><Text size='sm'>Tap the map to place a pin. Drag the pin to adjust it.</Text></>}
          {message && <Text size='sm' role='status'>{message}</Text>}
          {mode === 'pick' && position && (position.latitude === nearbyPosition?.latitude && position.longitude === nearbyPosition?.longitude
            ? <NearbyGardens position={nearbyPosition} />
            : <Text size='sm' role='status'>Checking nearby gardens…</Text>)}
        </Stack>
      </Paper>
      {position && <Marker
        position={[position.latitude, position.longitude]} icon={gardenIcon} draggable={!disabled} title='New garden location' eventHandlers={{
          dragend: ({ target }) => {
            if (disabled) { target.setLatLng([position.latitude, position.longitude]); return; }
            const point = target.getLatLng();
            if (latLngBounds(SAN_FRANCISCO_BOUNDS).contains(point)) onPositionChange?.({ latitude: point.lat, longitude: point.lng });
            else { target.setLatLng([position.latitude, position.longitude]); setMessage('Keep the pin within this map’s coverage.'); }
          }
        }}
                   />}
    </>
  );
}

function LeafletContainer ({ mode = 'explore', disabled = false, position, onPositionChange, onCreatePlot, selectedPlot, onSelectPlot, viewportSize }) {
  return (
    <MapContainer
      center={[37.7749, -122.4194]}
      zoom={13}
      // Picker views can unmount mid-zoom; Leaflet's zoom callback outlives the removed map.
      zoomAnimation={mode !== 'pick'}
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
      <MapSelection mode={mode} disabled={disabled} position={position} onPositionChange={onPositionChange} onCreatePlot={onCreatePlot} selectedPlot={selectedPlot} viewportSize={viewportSize} />
    </MapContainer>
  );
}

export default LeafletContainer;
