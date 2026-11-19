import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

window.matchMedia = vi.fn(query => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
window.scrollTo = vi.fn();
window.Element.prototype.scrollIntoView = vi.fn();
vi.stubGlobal('ResizeObserver', class {
  observe () {}
  unobserve () {}
  disconnect () {}
});
