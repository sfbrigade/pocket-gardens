import { keepPreviousData } from '@tanstack/react-query';
import Api from './Api.js';

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

export function canContributeToPlots (user) {
  return Boolean(user?.emailVerified && !user.banned);
}

export function canAdministerPlots (user) {
  return canContributeToPlots(user) && Boolean(user.isAdmin);
}

export function plotQueryOptions (id) {
  return {
    queryKey: ['plot', id],
    queryFn: ({ signal }) => Api.plots.get(id, signal).then(({ data }) => data),
  };
}

export async function cacheUpdatedPlot (client, plot, fields, routeId = plot.id) {
  const ids = new Set([plot.id, routeId]);
  const detail = {
    queryKey: ['plot'],
    predicate: ({ queryKey, state }) => queryKey.length === 2 && (ids.has(queryKey[1]) || state.data?.id === plot.id),
  };
  const changes = Object.fromEntries(fields.map((field) => [field, plot[field]]));
  const mapChanges = Object.fromEntries(['Pocket Garden Name', 'stage'].filter((field) => Object.hasOwn(changes, field)).map((field) => [field, changes[field]]));
  const affectsMap = Object.keys(mapChanges).length > 0;
  const viewports = { queryKey: ['plots'], predicate: ({ queryKey }) => queryKey.length === 2 && typeof queryKey[1] === 'object' };
  // Cancel reads that may have started before the save, including empty caches.
  await Promise.all([client.cancelQueries(detail), affectsMap && client.cancelQueries(viewports)]);
  const current = client.getQueryData(['plot', plot.id]) ?? client.getQueriesData(detail).find(([, cached]) => cached)?.[1] ?? plot;
  client.setQueriesData(detail, (cached) => cached && { ...cached, ...changes });
  for (const id of ids) {
    if (client.getQueryData(['plot', id]) === undefined) client.setQueryData(['plot', id], { ...current, ...changes });
  }
  client.invalidateQueries(detail);
  if (affectsMap) {
    client.setQueriesData(viewports, (rows) => rows?.map((row) => row.id === plot.id ? { ...row, ...mapChanges } : row));
    client.invalidateQueries(viewports);
  }
}

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
