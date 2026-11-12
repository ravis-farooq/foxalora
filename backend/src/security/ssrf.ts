import { BlockList, isIP } from 'node:net';
import { promises as dns } from 'node:dns';

/**
 * SSRF protection (PRD 5.5).
 * - Resolve the admin-configured hostname ourselves.
 * - Reject loopback / private / link-local / metadata ranges unless the admin
 *   explicitly set allowPrivate for that server.
 * - Return the validated IP so the caller connects to THAT ip (pinning) and the
 *   TLS layer still verifies the original hostname via `servername`.
 *   This closes the DNS-rebinding window between "check" and "connect".
 */
const blocked = new BlockList();
const v4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, 'ipv4');
blocked.addAddress('::1', 'ipv6');
blocked.addAddress('::', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
// IPv6 forms that can reach internal IPv4 hosts through translation (D18):
blocked.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64
blocked.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64
blocked.addSubnet('2002::', 16, 'ipv6'); // 6to4
blocked.addSubnet('2001::', 32, 'ipv6'); // Teredo
blocked.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
blocked.addSubnet('100::', 64, 'ipv6'); // discard
// No rule for IPv4-mapped ::ffff:0:0/96: Node's BlockList treats IPv4 and
// IPv4-mapped addresses as the same, so such a rule would block ALL of IPv4,
// and the IPv4 rules above already cover ::ffff:127.0.0.1 and friends.

export class SsrfError extends Error {
  /** Shown in logs and audit entries as the reason for a refused connection (FOX-025). */
  readonly code = 'SSRF_BLOCKED';
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export async function resolveSafeHost(host: string, allowPrivate: boolean): Promise<string> {
  return (await resolveSafeAddresses(host, allowPrivate))[0];
}

/**
 * All validated addresses for a host, IPv4 first. Callers try them in order on
 * connection failures: Docker's default network has no IPv6, so connecting only to
 * an AAAA record that happens to come first would fail every login.
 */
export async function resolveSafeAddresses(
  host: string,
  allowPrivate: boolean,
): Promise<string[]> {
  if (!host || host.length > 253) throw new SsrfError('invalid host');

  // Literal IP configured by admin
  if (isIP(host)) {
    if (!allowPrivate && isBlockedAddress(host)) {
      throw new SsrfError('destination not allowed');
    }
    return [host];
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host)) {
    throw new SsrfError('invalid hostname');
  }

  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new SsrfError('host did not resolve');

  // ALL resolved addresses must be allowed, otherwise reject.
  if (!allowPrivate) {
    for (const r of records) {
      if (isBlockedAddress(r.address)) {
        throw new SsrfError('destination not allowed');
      }
    }
  }
  return [...records].sort((a, b) => a.family - b.family).map((r) => r.address);
}
