import { describe, expect, it } from 'vitest'
import { sanitizeCardShopUrl, sanitizeUrl } from '../url'

describe('sanitizeCardShopUrl', () => {
  it.each([
    ['https://wzyp.cn/shop/CCZ33PW7'],
    ['https://shop.example.com/cards?utm=1'],
    ['https://sub.shop.example.co/shop/abc'],
    ['https://192.168.1.10/shop'],
    ['https://[2001:db8::1]/shop'],
  ])('accepts a valid absolute HTTPS shop URL (%s)', (input) => {
    expect(sanitizeCardShopUrl(input)).toBe(new URL(input).toString())
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeCardShopUrl('  https://wzyp.cn/shop/CCZ33PW7  ')).toBe(
      new URL('https://wzyp.cn/shop/CCZ33PW7').toString()
    )
  })

  it.each([
    ['plain http', 'http://wzyp.cn/shop/CCZ33PW7'],
    ['username', 'https://user@wzyp.cn/shop'],
    ['username+password', 'https://user:pass@wzyp.cn/shop'],
    ['relative path', '/shop/CCZ33PW7'],
    ['protocol-relative', '//wzyp.cn/shop'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['empty', '   '],
    ['no host', 'https://'],
    ['single-label host', 'https://localhost/shop'],
    ['bad label', 'https://-bad-.com/shop'],
    ['underscore label', 'https://bad_host.com/shop'],
    ['out-of-range ipv4', 'https://999.1.1.1/shop'],
  ])('rejects an invalid shop URL (%s)', (_name, input) => {
    expect(sanitizeCardShopUrl(input)).toBe('')
  })

  it('does not tighten the generic sanitizeUrl behavior', () => {
    // 通用 sanitizer 仍按原规则接受 http 与 userinfo，避免其他页面回归。
    expect(sanitizeUrl('http://example.com/x')).not.toBe('')
    expect(sanitizeUrl('https://user:pass@example.com/x')).not.toBe('')
  })
})
