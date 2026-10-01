import Api from './Api.js';

export function hasCoordinates ({ Latitude, Longitude }) {
  return Number.isFinite(Latitude) && Math.abs(Latitude) <= 90 &&
    Number.isFinite(Longitude) && Math.abs(Longitude) <= 180;
}

export function plotsQueryOptions (bounds) {
  return {
    queryKey: ['plots', bounds],
    enabled: bounds !== null,
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
