// Cryptographic vault for end-to-end media encryption (AES-256-GCM)
// Protects streaming links, referers, and movie details with zero-knowledge encryption

export const DEFAULT_VAULT_KEY = "Extreme-InfiniTV-Vault-Master-Key-2026-OLED"

/**
 * Derives a 256-bit AES-GCM CryptoKey from a human passphrase using SHA-256
 */
async function deriveKey(passphrase) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(passphrase || DEFAULT_VAULT_KEY))
  return crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  )
}

/**
 * Encrypts arbitrary data (object or string) into a base64 ciphertext string.
 * Prepend 12-byte IV for AES-GCM security.
 */
export async function encryptData(data, passphrase) {
  try {
    const jsonStr = typeof data === "string" ? data : JSON.stringify(data)
    const key = await deriveKey(passphrase)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const enc = new TextEncoder()
    const encoded = enc.encode(jsonStr)

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    )

    // Combine IV (12 bytes) + Ciphertext into one byte array
    const combined = new Uint8Array(iv.length + cipherBuffer.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(cipherBuffer), iv.length)

    // Convert to Base64
    let binary = ""
    const bytes = combined
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  } catch (err) {
    console.error("[crypto-vault] Encryption failed:", err)
    throw new Error("เข้ารหัสข้อมูลไม่สำเร็จ: " + (err.message || String(err)))
  }
}

/**
 * Decrypts a base64 ciphertext string back into the original parsed JSON object or string.
 */
export async function decryptData(encryptedBase64, passphrase) {
  try {
    if (!encryptedBase64 || typeof encryptedBase64 !== "string") return null
    const key = await deriveKey(passphrase)

    // Decode Base64 to Uint8Array
    const binary = atob(encryptedBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    if (bytes.length < 13) {
      throw new Error("ข้อมูลที่เข้ารหัสไม่สมบูรณ์ (ขนาดสั้นเกินไป)")
    }

    // Extract 12-byte IV and Ciphertext
    const iv = bytes.slice(0, 12)
    const ciphertext = bytes.slice(12)

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    )

    const dec = new TextDecoder()
    const plaintext = dec.decode(decryptedBuffer)
    try {
      return JSON.parse(plaintext)
    } catch {
      return plaintext
    }
  } catch (err) {
    console.error("[crypto-vault] Decryption failed:", err)
    throw new Error("ถอดรหัสข้อมูลไม่สำเร็จ (รหัสลับอาจไม่ตรงกัน): " + (err.message || String(err)))
  }
}
