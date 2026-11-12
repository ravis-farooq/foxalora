import { describe, expect, it, vi } from 'vitest';
import { promises as dns } from 'node:dns';
import { safeFilename } from '../src/security/filename';
import { decodeCssEscapes, sanitizeEmailHtml } from '../src/security/sanitize';
import { isBlockedAddress, resolveSafeAddresses, SsrfError } from '../src/security/ssrf';

describe('sanitizeEmailHtml', () => {
  it('removes scripts, handlers, frames, forms and javascript: links', () => {
    const out = sanitizeEmailHtml(
      '<p onclick="x()">a</p><script>x()</script><iframe src="https://e.example"></iframe>' +
        '<form action="https://e.example"><input></form><a href=" JaVaScRiPt:alert(1)">l</a><svg onload="x()"></svg>',
    );
    expect(out).not.toMatch(/onclick|<script|<iframe|<form|<input|javascript:|<svg/i);
    expect(out).toContain('<p>a</p>');
  });

  it('blocks remote images but keeps a marker for an opt-in', () => {
    const out = sanitizeEmailHtml('<img src="https://t.example/p.gif">');
    expect(out).not.toMatch(/ src=/);
    expect(out).toContain('data-blocked-src="https://t.example/p.gif"');
  });

  it('drops styles that load remote content, including CSS-escaped url() (D20)', () => {
    for (const style of [
      'background:url(https://t.example/a.gif)',
      'background-image:u\\72l(https://t.example/b.gif)',
      'background-image:\\75\\72\\6c(https://t.example/c.gif)',
      'background:image-set("https://t.example/d.gif" 1x)',
      'background:ur/**/l(https://t.example/e.gif)',
    ]) {
      expect(sanitizeEmailHtml(`<div style='${style}'>x</div>`)).toBe('<div>x</div>');
    }
    expect(sanitizeEmailHtml('<div style="color:#333;width:10px">x</div>')).toContain('style="color:#333;width:10px"');
  });

  it('decodes CSS escapes the way a browser does', () => {
    expect(decodeCssEscapes('u\\72 l(')).toBe('url(');
    expect(decodeCssEscapes('\\000075rl(')).toBe('url(');
    expect(decodeCssEscapes('\\u\\r\\l(')).toBe('url(');
  });
});

describe('safeFilename', () => {
  it('strips directories, control and bidi-override characters', () => {
    expect(safeFilename('../../evil.html')).toBe('evil.html');
    expect(safeFilename('C:\\Users\\x\\a.txt')).toBe('a.txt');
    expect(safeFilename('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(safeFilename('a\u0000b\r\n.txt')).toBe('ab.txt');
  });

  it('falls back for empty or dot-only names', () => {
    expect(safeFilename('', 'attachment-1')).toBe('attachment-1');
    expect(safeFilename('..', 'attachment-2')).toBe('attachment-2');
    expect(safeFilename(undefined)).toBe('attachment');
  });
});

describe('SSRF guard', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe'])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it('blocks IPv6 forms that translate to IPv4 (NAT64, 6to4, Teredo)', () => {
    for (const ip of ['64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2001:0:4136:e378::1'])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it('allows public IPv4 and IPv6 addresses (regression: IPv4-mapped rule blocked all IPv4)', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700:4700::1111'])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('returns every validated address, IPv4 first, so callers can fall back', async () => {
    const spy = vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '2001:4860:4860::8888', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ] as any);
    await expect(resolveSafeAddresses('mail.example.com', false)).resolves.toEqual(['8.8.8.8', '2001:4860:4860::8888']);
    spy.mockRestore();
  });

  it('rejects a host when any resolved address is private (DNS rebinding)', async () => {
    const spy = vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as any);
    await expect(resolveSafeAddresses('mail.example.com', false)).rejects.toBeInstanceOf(SsrfError);
    spy.mockRestore();
  });
});
