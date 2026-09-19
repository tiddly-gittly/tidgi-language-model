import { beforeEach } from 'vitest';

beforeEach(() => {
  if (!window.service) Object.defineProperty(window, 'service', { value: {}, configurable: true, writable: true });
  if (!window.observables) Object.defineProperty(window, 'observables', { value: {}, configurable: true, writable: true });
});
