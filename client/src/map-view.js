const key = 'pocket-gardens:explore-view';

export function readExploreView (plotId, storage) {
  if (!plotId) return null;
  try {
    const view = JSON.parse((storage || window.sessionStorage).getItem(key));
    if (view?.plotId === plotId && Array.isArray(view.center) && view.center.length === 2 && view.center.every(Number.isFinite) && Math.abs(view.center[0]) <= 90 && Math.abs(view.center[1]) <= 180 && Number.isFinite(view.zoom) && view.zoom >= 13 && view.zoom <= 22) return view;
  } catch {}
  return null;
}

export function saveExploreView (view, storage) {
  try { (storage || window.sessionStorage).setItem(key, JSON.stringify(view)); } catch {}
}
