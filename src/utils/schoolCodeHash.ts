function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('WebCrypto غير متوفر في هذه البيئة.');
  }
  return c.subtle;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(clean) || clean.length % 2 !== 0) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqualHex(aHex: string, bHex: string): boolean {
  const a = hexToBytes(aHex);
  const b = hexToBytes(bHex);
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function normalizeAccessCode(rawCode: string): string {
  if (typeof rawCode !== 'string') return '';
  return rawCode
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

export function isValidHex64(val: unknown): val is string {
  return typeof val === 'string' && /^[a-f0-9]{64}$/.test(val);
}

export async function computeCodeLookupId(schoolId: string, rawCode: string): Promise<string> {
  const clean = normalizeAccessCode(rawCode);
  if (!clean) return '';
  const data = new TextEncoder().encode(`${schoolId || 'default_school'}::${clean}`);
  const digest = await getSubtle().digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export function generateHex64(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function generateReadableCode(prefix = 'STU'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = new Uint8Array(6);
  globalThis.crypto.getRandomValues(rand);
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[rand[i] % chars.length];
  }
  return `${prefix}-${suffix}`;
}

export async function hashAdminCodePbkdf2(
  rawCode: string,
  iterations = 100000
): Promise<{ hash: string; salt: string; iterations: number }> {
  const clean = normalizeAccessCode(rawCode);
  if (!clean) {
    throw new Error('كود المدير لا يمكن أن يكون فارغاً.');
  }
  const safeIter = Math.max(10000, Math.min(1000000, Math.round(iterations)));
  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const salt = bytesToHex(saltBytes);

  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(clean),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: safeIter,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt,
    iterations: safeIter,
  };
}

export async function verifyAdminCodePbkdf2(
  rawCode: string,
  expectedHash: string,
  saltHex: string,
  iterations: number
): Promise<boolean> {
  if (!rawCode || !expectedHash || !saltHex || !iterations) return false;
  const saltBytes = hexToBytes(saltHex);
  if (saltBytes.length === 0) return false;

  const tryVerify = async (candidate: string): Promise<boolean> => {
    if (!candidate) return false;
    const subtle = getSubtle();
    const baseKey = await subtle.importKey(
      'raw',
      new TextEncoder().encode(candidate),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(saltBytes),
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      256
    );
    return constantTimeEqualHex(bytesToHex(new Uint8Array(derivedBits)), expectedHash);
  };

  try {
    const normalized = normalizeAccessCode(rawCode);
    if (normalized && (await tryVerify(normalized))) return true;
    const trimmed = rawCode.trim();
    if (trimmed && trimmed !== normalized) {
      return await tryVerify(trimmed);
    }
    return false;
  } catch {
    return false;
  }
}
