const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

const fromBase64 = (value: string): ArrayBuffer => {
  const raw = atob(value);
  return toArrayBuffer(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
};

const deriveKey = async (secret: string, journalId: string): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: textEncoder.encode(journalId),
      iterations: 120_000,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
};

export const encryptText = async (
  plaintext: string,
  secret: string,
  journalId: string,
): Promise<{ ciphertextBase64: string; ivBase64: string }> => {
  const key = await deriveKey(secret, journalId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(plaintext),
  );

  return {
    ciphertextBase64: toBase64(new Uint8Array(encrypted)),
    ivBase64: toBase64(iv),
  };
};

export const decryptText = async (
  ciphertextBase64: string,
  ivBase64: string,
  secret: string,
  journalId: string,
): Promise<string> => {
  const key = await deriveKey(secret, journalId);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(ivBase64),
    },
    key,
    fromBase64(ciphertextBase64),
  );

  return textDecoder.decode(decrypted);
};

export const encryptBytes = async (
  bytes: Uint8Array,
  secret: string,
  journalId: string,
): Promise<{ dataBase64: string; nonceBase64: string }> => {
  const key = await deriveKey(secret, journalId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
    },
    key,
    toArrayBuffer(bytes),
  );

  return {
    dataBase64: toBase64(new Uint8Array(encrypted)),
    nonceBase64: toBase64(nonce),
  };
};

export const decryptBytes = async (
  dataBase64: string,
  nonceBase64: string,
  secret: string,
  journalId: string,
): Promise<Uint8Array> => {
  const key = await deriveKey(secret, journalId);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(nonceBase64),
    },
    key,
    fromBase64(dataBase64),
  );

  return new Uint8Array(decrypted);
};
