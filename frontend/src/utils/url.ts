/**
 * 验证并规范化 URL
 * 默认只接受绝对 URL（以 http:// 或 https:// 开头），可按需允许相对路径
 * @param value 用户输入的 URL
 * @returns 规范化后的 URL，如果无效则返回空字符串
 */
type SanitizeOptions = {
  allowRelative?: boolean
  allowDataUrl?: boolean
}

export function sanitizeUrl(value: string, options: SanitizeOptions = {}): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (options.allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }

  // 允许 data:image/ 开头的 data URL（仅限图片类型）
  if (options.allowDataUrl && trimmed.startsWith('data:image/')) {
    return trimmed
  }

  // 只接受绝对 URL，不使用 base URL 来避免相对路径被解析为当前域名
  // 检查是否以 http:// 或 https:// 开头
  if (!trimmed.match(/^https?:\/\//i)) {
    return ''
  }

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

// 域名标签：字母数字开头结尾，中间允许连字符，总长 1-63。
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
// URL.hostname 对 IPv6 返回带方括号的形式，如 [::1]。
const IPV6_RE = /^\[[0-9a-f:.]+\]$/i

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false

  const ipv4 = hostname.match(IPV4_RE)
  if (ipv4) {
    return ipv4.slice(1).every((part) => Number(part) <= 255)
  }
  if (IPV6_RE.test(hostname)) return true

  const labels = hostname.split('.')
  // 卡密店铺是外部站点，要求至少两级（含顶级域），拒绝 localhost 之类。
  if (labels.length < 2) return false
  return labels.every((label) => DOMAIN_LABEL_RE.test(label))
}

/**
 * 卡密店铺地址的严格校验：只接受绝对 HTTPS URL、有有效 hostname、且不带
 * username/password。与通用 `sanitizeUrl` 分开实现，避免收紧其他页面的 URL
 * 规则造成回归。
 *
 * @returns 规范化后的 URL；非法或空值返回空字符串
 */
export function sanitizeCardShopUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // 明确拒绝危险协议，避免被 URL 解析器归一化后绕过。
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return ''
  // 相对路径不是有效的店铺入口。
  if (!/^https:\/\//i.test(trimmed)) return ''

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol.toLowerCase() !== 'https:') return ''
    if (parsed.username || parsed.password) return ''
    if (!isValidHostname(parsed.hostname)) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}
