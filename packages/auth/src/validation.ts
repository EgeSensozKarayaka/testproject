import { domainToASCII } from 'node:url';

export interface CanonicalEmail {
  display: string;
  normalized: string;
}

export class InvalidEmailError extends Error {
  constructor() {
    super('The email address is invalid.');
    this.name = 'InvalidEmailError';
  }
}

export function canonicalizeEmail(input: string): CanonicalEmail {
  const display = input.trim().normalize('NFC');
  if (display.length === 0 || display.length > 254) throw new InvalidEmailError();

  const separator = display.lastIndexOf('@');
  if (separator <= 0 || separator !== display.indexOf('@')) throw new InvalidEmailError();
  const local = display.slice(0, separator);
  const domain = display.slice(separator + 1);
  if (
    local.length > 64 ||
    !/^[\x21-\x7e]+$/.test(local) ||
    /(^\.|\.$|\.\.)/.test(local) ||
    /[()<>[\]:;,\\"\s]/.test(local)
  ) {
    throw new InvalidEmailError();
  }

  const asciiDomain = domainToASCII(domain).toLowerCase();
  if (
    asciiDomain.length === 0 ||
    asciiDomain.length > 253 ||
    !asciiDomain.includes('.') ||
    asciiDomain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new InvalidEmailError();
  }

  const normalized = `${local.toLowerCase()}@${asciiDomain}`;
  if (normalized.length > 254) throw new InvalidEmailError();
  return { display, normalized };
}

export function normalizeDisplayName(input: string): string {
  const value = input.trim().normalize('NFC');
  const length = [...value].length;
  if (length < 1 || length > 120) throw new Error('Display name must contain 1 to 120 characters.');
  return value;
}
