import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecureBrowserUuid } from './hostBindings';

describe('createSecureBrowserUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed instead of issuing a predictable all-zero id without Web Crypto', () => {
    vi.stubGlobal('crypto', undefined);

    expect(createSecureBrowserUuid).toThrow('secure_random_unavailable');
  });

  it('rejects an invalid entropy provider before it can emit an all-zero id', () => {
    vi.stubGlobal('crypto', { getRandomValues: () => undefined });

    expect(createSecureBrowserUuid).toThrow('secure_random_unavailable');
  });
});
