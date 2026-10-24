import { describe, it, expect } from 'vitest';
import config from '../wxt.config';

describe('manifest', () => {
  it('keeps the description within the Safari (App Store) limit of 112 characters', () => {
    const manifest = config.manifest as { description?: string };
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description!.length).toBeLessThanOrEqual(112);
  });
});
