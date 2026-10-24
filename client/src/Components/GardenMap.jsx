import { Component, lazy, Suspense } from 'react';
import { useMounted, useResizeObserver } from '@mantine/hooks';

const LeafletContainer = lazy(() => import('./LeafletContainer'));
const loadingMap = <div role='status'>Loading map...</div>;

class MapErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError () { return { failed: true }; }

  render () {
    return this.state.failed
      ? <div role='alert'>Unable to load the map. <button type='button' onClick={() => window.location.reload()}>Reload page</button></div>
      : this.props.children;
  }
}

export default function GardenMap (props) {
  const mounted = useMounted();
  const [containerRef, size] = useResizeObserver();
  return (
    <div ref={containerRef} style={{ height: '100%', width: '100%' }}>
      <MapErrorBoundary>
        <Suspense fallback={loadingMap}>
          {mounted ? <LeafletContainer {...props} viewportSize={size} /> : loadingMap}
        </Suspense>
      </MapErrorBoundary>
    </div>
  );
}
