export const plotStageLabels = {
  potential: 'Potential site', preparing: 'Preparing', active: 'Active', paused: 'Paused', archived: 'Archived',
};

export function plotStageLabel (stage) {
  return plotStageLabels[stage] || 'Stage not recorded';
}

export const plotPermissionLabels = {
  unknown: 'Unknown',
  needed: 'Needed',
  progress: 'In progress',
  confirmed: 'Confirmed',
  not_required: 'Not required',
  not_granted: 'Not granted',
};

import Api from './Api.js';
import { keepPreviousData } from '@tanstack/react-query';

export function hasCoordinates ({ Latitude, Longitude }) {
  return Number.isFinite(Latitude) && Math.abs(Latitude) <= 90 &&
    Number.isFinite(Longitude) && Math.abs(Longitude) <= 180;
}

export function containsBounds (coverage, visible) {
  return coverage && visible.north <= coverage.north && visible.south >= coverage.south &&
    visible.east <= coverage.east && visible.west >= coverage.west;
}

export function bufferedBounds (visible, padding = 0.25) {
  const latitudePadding = (visible.north - visible.south) * padding;
  const longitudePadding = (visible.east - visible.west) * padding;
  return {
    north: Math.min(90, visible.north + latitudePadding),
    south: Math.max(-90, visible.south - latitudePadding),
    east: Math.min(180, visible.east + longitudePadding),
    west: Math.max(-180, visible.west - longitudePadding),
  };
}

export function plotsQueryOptions (bounds) {
  return {
    queryKey: ['plots', bounds],
    enabled: bounds !== null,
    // Reopening a picker can reuse recent results; saves still invalidate them.
    staleTime: 30_000,
    // Keep markers mounted when opening a popup pans the map and refreshes bounds.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const plots = [];
      let offset;
      do {
        const response = await Api.plots.index({ ...bounds, offset, pageSize: 100 }, signal);
        plots.push(...response.data);
        offset = response.headers['x-next-offset'];
      } while (offset);
      return plots.filter(hasCoordinates);
    },
  };
}
