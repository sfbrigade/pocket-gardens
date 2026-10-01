import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('homepage server rendering keeps Leaflet behind the browser mount', async (t) => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  t.after(() => vite.close());
  const { render } = await vite.ssrLoadModule('/src/entry-server.jsx');
  const request = { url: '/', urlData: () => '/' };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { html } = await render(request, {}, { context: {} });
    assert.match(html, /role="status">Loading map\.\.\./);
    assert.doesNotMatch(html, /data-msg=|window is not defined|leaflet-container/);
  }
});
