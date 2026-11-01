import { describe, it, expect } from 'vitest';
import { describeOrigin } from '../entrypoints/popup/utils/origin';

describe('describeOrigin (F093)', () => {
  it('keeps a non-default port, so two local apps read differently', () => {
    expect(describeOrigin('http://localhost:3000').label).toBe('localhost:3000');
    expect(describeOrigin('http://localhost:8080').label).toBe('localhost:8080');
  });

  it('drops a default port', () => {
    expect(describeOrigin('https://example.com:443').label).toBe('example.com');
    expect(describeOrigin('http://example.com:80').label).toBe('example.com');
    expect(describeOrigin('https://app.example.com').label).toBe('app.example.com');
  });

  it('flags plain http to another host', () => {
    expect(describeOrigin('http://example.com')).toEqual({ label: 'example.com', insecure: true });
    expect(describeOrigin('http://192.168.1.20:3000').insecure).toBe(true);
    expect(describeOrigin('https://example.com').insecure).toBe(false);
  });

  it('does not flag loopback over http', () => {
    for (const o of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.8.9.10', 'http://[::1]:3000', 'http://app.localhost:3000']) {
      expect(describeOrigin(o).insecure, o).toBe(false);
    }
    expect(describeOrigin('http://[::1]:3000').label).toBe('[::1]:3000');
  });

  it('passes unparseable input through unflagged', () => {
    expect(describeOrigin('not an origin')).toEqual({ label: 'not an origin', insecure: false });
    expect(describeOrigin('')).toEqual({ label: '', insecure: false });
  });
});
