export const SAN_FRANCISCO_BOUNDS = [[37.708, -122.515], [37.833, -122.355]];

export function isMapPosition (position) {
  return Number.isFinite(position?.latitude) && Number.isFinite(position?.longitude) &&
    position.latitude >= SAN_FRANCISCO_BOUNDS[0][0] && position.latitude <= SAN_FRANCISCO_BOUNDS[1][0] &&
    position.longitude >= SAN_FRANCISCO_BOUNDS[0][1] && position.longitude <= SAN_FRANCISCO_BOUNDS[1][1];
}
