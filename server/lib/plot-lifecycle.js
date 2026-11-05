export const PLOT_STAGES = ['potential', 'preparing', 'active', 'paused', 'archived'];

export function firstPlantedIssue (stage, firstPlanted) {
  if (firstPlanted && stage !== 'active') {
    return { code: 'custom', path: ['firstPlanted'], message: 'First planted is only recorded for active gardens' };
  }
}
