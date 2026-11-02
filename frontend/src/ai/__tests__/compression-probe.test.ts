// W2-R2 probe (AC-2): CompressionStream / DecompressionStream accept 'deflate-raw' in the frontend test runtime.
// Reference only: happy-dom exposes the Node runtime's streams, so this is not browser evidence. The browser
// evidence (real Chromium / WebKit consoles) is recorded in .agent-team/08-impl-notes/ml.md.
import { describe, expect, it } from 'vitest';

describe('deflate-raw availability (happy-dom / Node runtime)', () => {
  it('constructs both streams with deflate-raw and round-trips bytes', async () => {
    expect(typeof CompressionStream).toBe('function');
    expect(typeof DecompressionStream).toBe('function');
    const input = new TextEncoder().encode('checky '.repeat(50));
    const packed = await new Response(new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    const unpacked = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    expect(packed.byteLength).toBeLessThan(input.byteLength);
    expect(new Uint8Array(unpacked)).toEqual(input);
    console.log(`deflate-raw ok: ${input.byteLength} -> ${packed.byteLength} bytes, runtime ${navigator.userAgent}`);
  });

  it('rejects an unknown format with TypeError (the E-SHR-UNSUPPORTED detection path)', () => {
    // @ts-expect-error -- deliberately outside CompressionFormat
    expect(() => new CompressionStream('brotli-x')).toThrow(TypeError);
  });
});
