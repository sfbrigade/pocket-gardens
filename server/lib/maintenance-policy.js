import { DateTime } from 'luxon';
import { PhotoUploadError } from '#lib/photo-upload.js';

export const activities = ['Watered', 'Weeded', 'Planted', 'Mulched', 'Cleared litter', 'Just had a look', 'Something else'];
export const observations = ['Nothing stood out', 'Plants look dry', 'Gaps, or plants missing', 'Weeds taking over', 'Litter or dog waste', 'Something broken', 'Something else'];
export const maintenanceZone = 'America/Los_Angeles';
export const today = () => DateTime.now().setZone(maintenanceZone).toISODate();

export function allowsAnonymousMaintenance (env = process.env) {
  return env.NODE_ENV === 'development' && env.ALLOW_ANONYMOUS_MAINTENANCE_WRITES === 'true';
}

export function canWriteMaintenance (user, env = process.env) {
  return allowsAnonymousMaintenance(env) || !!(user?.isActive && user?.isAdmin);
}

export function requireMaintenanceWriter (fastify) {
  return async (request, reply) => {
    if (!allowsAnonymousMaintenance()) return fastify.requireAdmin(request, reply);
  };
}

export function validateNewVisit (plot, body) {
  if (!['potential', 'preparing', 'active', 'paused'].includes(plot.stage)) {
    throw new PhotoUploadError('This garden is not accepting new updates.', 'plotId');
  }
  if (plot.stage === 'paused' && (body.activity?.length || body.plants?.length)) {
    throw new PhotoUploadError('Paused gardens accept observations, notes, and photos only.', 'activity');
  }
}
