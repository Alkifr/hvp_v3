/** UUID v4 без `crypto.randomUUID`: на обычном HTTP (не localhost) этого метода нет. */

type UuidString = `${string}-${string}-${string}-${string}-${string}`;

function fallbackUuid(): UuidString {
  const bytes = new Uint8Array(16);
  try {
    const fill = globalThis.crypto?.getRandomValues;
    if (typeof fill === "function") fill.call(globalThis.crypto, bytes);
    else throw new Error("no getRandomValues");
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function safeRandomUuid(): string {
  try {
    const cryptoObj = globalThis.crypto;
    const randomUUID = cryptoObj?.randomUUID;
    if (typeof randomUUID === "function") {
      const id = randomUUID.call(cryptoObj);
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    // Метод есть в объекте, но в небезопасном контексте вызов бросает TypeError.
  }
  return fallbackUuid();
}

/**
 * Подменяет `crypto.randomUUID`, если его нет или вызов падает.
 * Иначе любое обращение из React-обновления состояния оставляет белый экран.
 */
export function installRandomUuidPolyfill(): void {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj) return;
  let native: (() => string) | undefined;
  try {
    const value: unknown = cryptoObj.randomUUID;
    if (typeof value === "function") native = value as () => string;
  } catch {
    native = undefined;
  }
  if (native) {
    try {
      const probe = native.call(cryptoObj);
      if (typeof probe === "string" && probe.length > 0) return;
    } catch {
      // Заменяем ниже.
    }
  }
  const polyfill = function randomUUID(): UuidString {
    return fallbackUuid();
  };
  try {
    Object.defineProperty(cryptoObj, "randomUUID", { configurable: true, writable: true, value: polyfill });
  } catch {
    try {
      cryptoObj.randomUUID = polyfill;
    } catch {
      // Оставляем safeRandomUuid как запасной путь для своего кода.
    }
  }
}
