// Admin authentication and PIN security management

const STORAGE_PIN_KEY = "xt_admin_pin"
const SESSION_AUTH_KEY = "xt_admin_session"
const DEFAULT_PIN = "1234"

/**
 * Simple hash helper for storing the PIN safely in browser storage
 */
async function hashPin(pin) {
  const enc = new TextEncoder()
  const data = enc.encode(`xt_salt_${pin}_secure`)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data)
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }
  // Fallback for non-subtle contexts
  return btoa(`xt_salt_${pin}`)
}

/**
 * Get the currently configured PIN hash (defaults to hash of "1234")
 */
export async function getStoredPinHash() {
  if (typeof localStorage === "undefined") return await hashPin(DEFAULT_PIN)
  const stored = localStorage.getItem(STORAGE_PIN_KEY)
  if (!stored) {
    const defHash = await hashPin(DEFAULT_PIN)
    localStorage.setItem(STORAGE_PIN_KEY, defHash)
    return defHash
  }
  return stored
}

/**
 * Check if the admin is currently authenticated in this browser session
 */
export function isAuthenticated() {
  if (typeof sessionStorage === "undefined") return false
  return sessionStorage.getItem(SESSION_AUTH_KEY) === "1"
}

/**
 * Verify user's entered PIN. If correct, marks session as authenticated.
 */
export async function verifyPin(enteredPin) {
  if (!enteredPin || typeof enteredPin !== "string") return false
  const enteredHash = await hashPin(enteredPin.trim())
  const storedHash = await getStoredPinHash()

  if (enteredHash === storedHash) {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_AUTH_KEY, "1")
    }
    return true
  }
  return false
}

/**
 * Change the admin PIN after verifying the current PIN
 */
export async function changePin(currentPin, newPin) {
  const isValid = await verifyPin(currentPin)
  if (!isValid) return { success: false, error: "รหัส PIN ปัจจุบันไม่ถูกต้อง" }

  if (!newPin || newPin.trim().length < 4) {
    return { success: false, error: "รหัส PIN ใหม่ต้องมีความยาวอย่างน้อย 4 หลัก" }
  }

  const newHash = await hashPin(newPin.trim())
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_PIN_KEY, newHash)
  }
  return { success: true }
}

/**
 * Logout / Lock the admin backoffice session
 */
export function logout() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(SESSION_AUTH_KEY)
  }
}
