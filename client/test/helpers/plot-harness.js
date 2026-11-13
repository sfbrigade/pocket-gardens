import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

export const draftStorageKey = 'pocket-gardens:plot-draft:v1';

export async function interact (action) {
  await act(async () => { await action(); });
}

export async function waitFor (assertion) {
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      return assertion();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    await act(async () => { await delay(10); });
  }
}

export async function setupPlotTests (t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = Object.fromEntries([
    'window', 'document', 'Document', 'navigator', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'ShadowRoot', 'Node',
    'CustomEvent', 'File',
  ].map((key) => [key, dom.window[key]]));
  Object.assign(globals, {
    ResizeObserver: class { observe () {} unobserve () {} disconnect () {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
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

  let nextPreview = 0;
  t.mock.method(URL, 'createObjectURL', () => `blob:test-${++nextPreview}`);
  const revokePreview = t.mock.method(URL, 'revokeObjectURL', () => {});
  // Import the client renderer after installing the DOM so React enables input events.
  const { createRoot } = await import('react-dom/client');
  const { MantineProvider } = await import('@mantine/core');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter, Route, Routes, useLocation, useNavigate } = await import('react-router');
  const { createHead, UnheadProvider } = await import('@unhead/react/server');
  const vite = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  t.after(() => vite.close());
  const { default: PlotForm } = await vite.ssrLoadModule('/src/Plots/PlotForm.jsx');
  const { default: Api } = await vite.ssrLoadModule('/src/Api.js');
  t.mock.method(Api.plots, 'capabilities', async () => ({ data: { canCreatePlot: true } }));
  // Keep real modal portals so the plant form is outside the garden form in
  // the DOM. Disable animations, which are outside these interaction checks.
  const theme = { components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } };

  async function mount (test) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['plots', 'capabilities'], { canCreatePlot: true });
    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);
    let disposed = false;
    async function unmount () {
      if (disposed) return;
      disposed = true;
      await interact(() => root.unmount());
      client.clear();
      container.remove();
    }
    test.after(unmount);
    let navigate;
    let path;
    function Location () {
      navigate = useNavigate();
      path = useLocation().pathname;
      return null;
    }
    await interact(() => root.render(h(QueryClientProvider, { client },
      h(MantineProvider, { theme },
        h(UnheadProvider, { value: createHead() },
          h(MemoryRouter, { initialEntries: ['/plots/new'] },
            h(Location),
            h(Routes, null,
              h(Route, { path: '/plots/new', element: h(PlotForm) }),
              h(Route, { path: '*', element: h('div', null, 'Map or saved garden') }))))))));
    const field = (label) => {
      const element = [...dom.window.document.querySelectorAll('label')].find((element) => element.textContent.replace(/\s*\*$/, '').trim() === label);
      const input = element && dom.window.document.getElementById(element.htmlFor);
      assert.ok(input, `Field not found: ${label}`);
      return input;
    };
    const button = (text) => {
      const element = [...dom.window.document.querySelectorAll('button')].find((element) => element.textContent.trim() === text || element.getAttribute('aria-label') === text);
      assert.ok(element, `Button not found: ${text}`);
      return element;
    };
    return {
      client,
      container,
      field,
      button,
      unmount,
      get path () { return path; },
      navigate: (path) => interact(() => navigate(path)),
      change: (label, value) => interact(() => {
        const input = field(label);
        const prototype = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      }),
      click: (text) => interact(() => button(text).click()),
      submit: () => interact(() => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))),
      upload: () => interact(() => {
        const input = container.querySelector('input[type=file]');
        const file = new dom.window.File(['photo'], 'garden.jpg', { type: 'image/jpeg' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      }),
      selectPlantOption: (text) => interact(() => {
        const element = [...dom.window.document.querySelectorAll('[role=option]')].find((element) => element.textContent.trim() === text);
        assert.ok(element, `Plant option not found: ${text}`);
        element.click();
      }),
    };
  }

  return { dom, Api, mount, revokePreview, readDraft: () => JSON.parse(dom.window.sessionStorage.getItem(draftStorageKey)) };
}
