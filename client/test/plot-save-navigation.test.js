import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { act, createElement as h } from 'react';
import { createServer } from 'vite';
import { createPlotDraft } from '../src/Plots/plot-form.js';

const draftKey = 'pocket-gardens:plot-draft:v1';

test('garden saves respect navigation and newer drafts', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Document: dom.window.Document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element,
    ShadowRoot: dom.window.ShadowRoot,
    ResizeObserver: class { observe () {} unobserve () {} disconnect () {} },
    Node: dom.window.Node,
    CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = (media) => ({ matches: false, media, addEventListener () {}, removeEventListener () {} });
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const { createRoot } = await import('react-dom/client');
  const { MantineProvider } = await import('@mantine/core');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter, Route, Routes, useLocation, useNavigate } = await import('react-router');
  const { createHead, UnheadProvider } = await import('@unhead/react/server');
  const vite = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  t.after(() => vite.close());
  const { default: PlotForm } = await vite.ssrLoadModule('/src/Plots/PlotForm.jsx');
  const { default: Api } = await vite.ssrLoadModule('/src/Api.js');
  t.mock.method(Api.plots, 'capabilities', async () => ({ data: { canCreatePlot: true } }));

  async function flush (action) {
    await act(async () => {
      action?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  for (const scenario of ['stay', 'leave', 'edit restored draft', 'start another draft']) {
    await t.test(scenario, async (t) => {
      const original = { ...createPlotDraft(), locator: 'Second tree well', position: { latitude: 37.77, longitude: -122.43 }, addressEdited: true };
      dom.window.sessionStorage.setItem(draftKey, JSON.stringify(original));
      let completeSave;
      t.mock.method(Api.plots, 'create', () => new Promise((resolve) => { completeSave = resolve; }));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      client.setQueryData(['plots', 'capabilities'], { canCreatePlot: true });
      const container = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(container);
      const root = createRoot(container);
      t.after(async () => {
        await act(() => root.unmount());
        client.clear();
        container.remove();
      });
      let navigate;
      let path;
      function Location () {
        navigate = useNavigate();
        path = useLocation().pathname;
        return null;
      }
      await flush(() => root.render(h(QueryClientProvider, { client },
        h(MantineProvider, { env: 'test' },
          h(UnheadProvider, { value: createHead() },
            h(MemoryRouter, { initialEntries: ['/plots/new'] },
              h(Location),
              h(Routes, null,
                h(Route, { path: '/plots/new', element: h(PlotForm) }),
                h(Route, { path: '*', element: h('div', null, 'Map or saved garden') }))))))));
      await flush();
      assert.equal(container.querySelector('textarea').value, original.locator);
      await flush(() => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(typeof completeSave, 'function');

      if (scenario !== 'stay') {
        const back = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Back to map');
        await flush(() => back.click());
        assert.equal(path, '/');
      }
      if (scenario === 'start another draft') {
        dom.window.sessionStorage.removeItem(draftKey);
        dom.window.sessionStorage.setItem(draftKey, JSON.stringify({ ...original, submissionId: crypto.randomUUID() }));
      }
      if (scenario === 'edit restored draft' || scenario === 'start another draft') {
        await flush(() => navigate('/plots/new'));
        await flush();
        const input = container.querySelector('textarea');
        await flush(() => {
          Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Third tree well');
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        assert.equal(JSON.parse(dom.window.sessionStorage.getItem(draftKey)).locator, 'Third tree well');
      }
      const draftBeforeSuccess = dom.window.sessionStorage.getItem(draftKey);
      const saved = { id: 'pg_saved-original' };
      await flush(() => completeSave({ data: saved }));
      await flush();
      assert.deepEqual(client.getQueryData(['plot', saved.id]), saved);
      if (scenario === 'stay') {
        assert.equal(path, `/plots/${saved.id}`);
        assert.equal(dom.window.sessionStorage.getItem(draftKey), null);
      } else {
        assert.equal(path, scenario === 'leave' ? '/' : '/plots/new');
        assert.equal(dom.window.sessionStorage.getItem(draftKey), draftBeforeSuccess);
      }
    });
  }
});
