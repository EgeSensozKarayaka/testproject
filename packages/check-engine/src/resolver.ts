import { Resolver } from 'node:dns/promises';

import type { ResolvedAddress, ResolverPort } from './types.js';

export class DnsResolutionError extends Error {
  public override readonly name = 'DnsResolutionError';

  public constructor(public readonly code: 'NXDOMAIN' | 'SERVFAIL' | 'NO_ADDRESS') {
    super(code);
  }
}

function dnsCode(reason: unknown): string | undefined {
  return typeof reason === 'object' && reason !== null && 'code' in reason
    ? String(reason.code)
    : undefined;
}

export class NodeDnsResolver implements ResolverPort {
  public async resolve(hostname: string, signal: AbortSignal): Promise<readonly ResolvedAddress[]> {
    const resolver = new Resolver();
    const cancel = () => resolver.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const [ipv4, ipv6] = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]);
      if (signal.aborted) throw signal.reason;

      const addresses: ResolvedAddress[] = [];
      if (ipv4.status === 'fulfilled') {
        addresses.push(...ipv4.value.map((address) => ({ address, family: 4 as const })));
      }
      if (ipv6.status === 'fulfilled') {
        addresses.push(...ipv6.value.map((address) => ({ address, family: 6 as const })));
      }
      if (addresses.length > 0) return addresses;

      const codes = [
        ipv4.status === 'rejected' ? dnsCode(ipv4.reason) : undefined,
        ipv6.status === 'rejected' ? dnsCode(ipv6.reason) : undefined,
      ];
      if (codes.some((code) => code === 'ENOTFOUND' || code === 'ENODATA')) {
        throw new DnsResolutionError('NXDOMAIN');
      }
      if (codes.some((code) => code === 'ESERVFAIL' || code === 'EREFUSED')) {
        throw new DnsResolutionError('SERVFAIL');
      }
      throw new DnsResolutionError('NO_ADDRESS');
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
}
