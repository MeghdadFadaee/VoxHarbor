import { resolve4 } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function publicIPv4(address) {
  return ipaddr.IPv4.isValidFourPartDecimal(address || '') && ipaddr.parse(address).range() === 'unicast';
}
export async function resolveTeamSpeak(config, resolver = resolve4) {
  const port = config.ts3Port;
  const host = config.ts3Host;
  if (!host || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Configure an authorized TeamSpeak destination');
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new Error('Invalid TeamSpeak hostname');
  let timeout;
  try {
    const addresses = publicIPv4(host) ? [host] : await Promise.race([
      resolver(host), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Destination resolution timed out')), 3000); }),
    ]);
    if (!addresses.length || !addresses.every(publicIPv4)) throw new Error('TeamSpeak destination is private or reserved');
    // The native library receives a numeric SocketAddr and cannot re-resolve or redirect it.
    return { address: `${addresses[0]}:${port}`, host, port };
  } finally { clearTimeout(timeout); }
}
