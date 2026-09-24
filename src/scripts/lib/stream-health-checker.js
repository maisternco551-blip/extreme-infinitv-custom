// Stream Health Checker: Tests streaming URLs (.m3u8, .mp4, direct streams)
// and returns status: "online" (พร้อมเล่น), "offline" (ดับ/ต้องแก้ไข), or "unknown"

const healthCache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes cache
const listeners = new Set()

export function notifyHealthListeners() {
  for (const listener of listeners) {
    try {
      listener(healthCache)
    } catch (_) {}
  }
}

export function subscribeHealth(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function getCachedHealth(url) {
  if (!url) return null
  const entry = healthCache.get(url)
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry
  }
  return null
}

/**
 * Checks a single stream URL health
 * @param {string} url
 * @param {string} [referer]
 * @param {number} [timeoutMs=4500]
 * @returns {Promise<{ status: "online" | "offline" | "unknown", code?: number, latencyMs?: number, message: string }>}
 */
export async function checkStreamHealth(url, referer = "", timeoutMs = 4500) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return { status: "offline", message: "ไม่มีลิงก์สตรีม" }
  }

  const cleanUrl = url.trim()
  const cached = getCachedHealth(cleanUrl)
  if (cached) return cached

  const startTime = Date.now()

  // Helper to record and return
  function setAndReturn(result) {
    const enriched = {
      ...result,
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime
    }
    healthCache.set(cleanUrl, enriched)
    notifyHealthListeners()
    return enriched
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null
  const timeoutId = setTimeout(() => controller?.abort(), timeoutMs)

  // Step 1: Try HTTP HEAD with fetch
  try {
    const headers = {}
    if (referer) {
      headers["Referer"] = referer
    }

    const resp = await fetch(cleanUrl, {
      method: "HEAD",
      headers,
      signal: controller?.signal
    })

    clearTimeout(timeoutId)

    if (resp.ok || (resp.status >= 200 && resp.status < 400)) {
      return setAndReturn({
        status: "online",
        code: resp.status,
        message: `พร้อมเล่น (HTTP ${resp.status})`
      })
    }

    if (resp.status >= 400 && resp.status < 600) {
      return setAndReturn({
        status: "offline",
        code: resp.status,
        message: `ลิงก์ดับ/เสีย (HTTP ${resp.status})`
      })
    }
  } catch (err) {
    clearTimeout(timeoutId)
    // If it was an explicit timeout
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return setAndReturn({
        status: "offline",
        code: 408,
        message: "หมดเวลาเชื่อมต่อ (เซิร์ฟเวอร์ไม่ตอบสนอง)"
      })
    }
    // Likely CORS restriction in browser - fall through to Step 2
  }

  // Step 2: Try GET with no-cors or HTMLMediaElement probe
  if (typeof window !== "undefined") {
    // Probe via lightweight Video element
    try {
      const probeResult = await new Promise((resolve) => {
        let finished = false
        const v = document.createElement("video")
        v.preload = "metadata"
        v.muted = true

        const probeTimeout = setTimeout(() => {
          if (finished) return
          finished = true
          cleanup()
          // If video metadata probe timed out, try no-cors fetch test
          resolve(null)
        }, Math.min(timeoutMs, 3000))

        function cleanup() {
          clearTimeout(probeTimeout)
          v.removeAttribute("src")
          try { v.load() } catch (_) {}
        }

        v.onloadedmetadata = () => {
          if (finished) return
          finished = true
          cleanup()
          resolve({ status: "online", code: 200, message: "พร้อมเล่น (Media Probe OK)" })
        }

        v.oncanplay = () => {
          if (finished) return
          finished = true
          cleanup()
          resolve({ status: "online", code: 200, message: "พร้อมเล่น (Media CanPlay)" })
        }

        v.onerror = () => {
          if (finished) return
          finished = true
          cleanup()
          resolve({ status: "offline", code: 404, message: "ลิงก์เสียหรือเปิดไม่ได้" })
        }

        v.src = cleanUrl
      })

      if (probeResult) {
        return setAndReturn(probeResult)
      }
    } catch (_) {}

    // Fallback: no-cors fetch probe to see if server host is alive
    try {
      const controller2 = typeof AbortController !== "undefined" ? new AbortController() : null
      const timeout2 = setTimeout(() => controller2?.abort(), 2500)
      await fetch(cleanUrl, {
        method: "GET",
        mode: "no-cors",
        signal: controller2?.signal
      })
      clearTimeout(timeout2)
      return setAndReturn({
        status: "online",
        code: 200,
        message: "พร้อมเล่น (Host Active)"
      })
    } catch (err2) {
      return setAndReturn({
        status: "offline",
        code: 503,
        message: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้"
      })
    }
  }

  return setAndReturn({
    status: "unknown",
    message: "ไม่สามารถระบุสถานะได้"
  })
}

/**
 * Run health checks on multiple URLs with concurrency control
 * @param {Array<{ id: any, url: string, referer?: string }>} items
 * @param {Function} [onItemChecked]
 * @param {number} [concurrency=4]
 */
export async function batchCheckStreamHealth(items, onItemChecked, concurrency = 4) {
  if (!Array.isArray(items) || items.length === 0) return {}

  const results = {}
  let index = 0

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++
      const item = items[currentIndex]
      if (!item || !item.url) continue
      const res = await checkStreamHealth(item.url, item.referer || "", 4000)
      results[item.id] = res
      if (onItemChecked) {
        onItemChecked(item.id, res, currentIndex + 1, items.length)
      }
    }
  }

  const pool = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    pool.push(worker())
  }
  await Promise.all(pool)
  return results
}
