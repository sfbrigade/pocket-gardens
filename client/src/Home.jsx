import { Container } from "@mantine/core";
import { useHead } from "@unhead/react";
import { Component, lazy, Suspense, useEffect, useState } from "react";

const LeafletContainer = lazy(() => import("./Components/LeafletContainer"));
const loadingMap = <div role="status">Loading map...</div>;

class MapErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <div role="alert">
        <p>Unable to load the map.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Home() {
  useHead({ title: "Pocket Gardens" });
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Container
      fluid
      p={0}
      style={{
        height:
          "calc(100dvh - var(--app-shell-header-offset) - 2 * var(--app-shell-padding))",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          overflow: "hidden",
          position: "relative",
          zIndex: 0,
        }}
      >
        <MapErrorBoundary>
          <Suspense fallback={loadingMap}>
            {mounted ? <LeafletContainer /> : loadingMap}
          </Suspense>
        </MapErrorBoundary>
      </div>
    </Container>
  );
}

export default Home;
