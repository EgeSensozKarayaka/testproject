import { describe, expect, it } from 'vitest';

import { StreamingByteMatcher } from './matcher.js';

describe('StreamingByteMatcher', () => {
  it('matches across every chunk boundary without retaining the body', () => {
    const body = Buffer.from('prefix-çalışıyor-suffix', 'utf8');
    const pattern = Buffer.from('çalışıyor', 'utf8');
    for (let boundary = 1; boundary < body.length; boundary += 1) {
      const matcher = new StreamingByteMatcher(pattern);
      matcher.push(body.subarray(0, boundary));
      matcher.push(body.subarray(boundary));
      expect(matcher.found).toBe(true);
    }
  });

  it('does not report partial or case-insensitive matches', () => {
    const matcher = new StreamingByteMatcher(Buffer.from('Expected'));
    matcher.push(Buffer.from('expect'));
    matcher.push(Buffer.from('ed'));
    expect(matcher.found).toBe(false);
  });
});
