// Supabase Cloud Database Client with AES-256 End-to-End Encryption
import { encryptData, decryptData, DEFAULT_VAULT_KEY } from "@/scripts/lib/crypto-vault.js"
import { ensureActiveLibrary, getLibraryMovies, getLibrarySeries, getSeriesDetails, VOD_TTL } from "@/scripts/lib/media-library.js"
import { setCached } from "@/scripts/lib/cache.js"

const CLOUD_CONFIG_KEY = "xt_cloud_config"
const CATALOG_ROW_ID = "main_catalog"

export const DEFAULT_SQL_SETUP = `-- 1. สร้างตารางเก็บข้อมูลแคตตาล็อกหนังและซีรีส์ (เข้ารหัสความปลอดภัย AES-256)
create table if not exists public.media_catalog (
  id text primary key default 'main_catalog',
  movies_encrypted text,
  series_encrypted text,
  series_details_encrypted text,
  movie_count integer default 0,
  series_count integer default 0,
  updated_at timestamptz default now()
);

-- 2. เปิดใช้งานระบบความปลอดภัย Row Level Security (RLS)
alter table public.media_catalog enable row level security;

-- 3. กำหนดสิทธิ์: อนุญาตให้อ่านข้อมูลได้ (สำหรับแอปทีวี/มือถือ)
drop policy if exists "Allow read access" on public.media_catalog;
create policy "Allow read access" on public.media_catalog
  for select using (true);

-- 4. กำหนดสิทธิ์: อนุญาตให้บันทึกและแก้ไขข้อมูลได้ (สำหรับแอดมิน)
drop policy if exists "Allow upsert access" on public.media_catalog;
create policy "Allow upsert access" on public.media_catalog
  for all using (true) with check (true);
`

/**
 * Get current Cloud configuration
 */
export function getCloudConfig() {
  if (typeof window === "undefined") {
    return { url: "", anonKey: "", vaultKey: DEFAULT_VAULT_KEY, autoSync: true }
  }

  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        url: parsed.url || "",
        anonKey: parsed.anonKey || "",
        vaultKey: parsed.vaultKey || DEFAULT_VAULT_KEY,
        autoSync: parsed.autoSync !== false,
        lastSyncedAt: parsed.lastSyncedAt || null
      }
    }
  } catch (err) {
    console.warn("[cloud-catalog] Failed to read cloud config:", err)
  }

  return {
    url: "",
    anonKey: "",
    vaultKey: DEFAULT_VAULT_KEY,
    autoSync: true,
    lastSyncedAt: null
  }
}

/**
 * Save Cloud configuration
 */
export function saveCloudConfig(config) {
  if (typeof window === "undefined") return
  const current = getCloudConfig()
  const updated = {
    ...current,
    url: String(config.url || "").trim().replace(/\/+$/, ""),
    anonKey: String(config.anonKey || "").trim(),
    vaultKey: String(config.vaultKey || "").trim() || DEFAULT_VAULT_KEY,
    autoSync: config.autoSync !== false,
    lastSyncedAt: config.lastSyncedAt !== undefined ? config.lastSyncedAt : current.lastSyncedAt
  }
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(updated))
  return updated
}

/**
 * Test connection to Supabase database
 */
export async function testCloudConnection(config) {
  const url = String(config?.url || "").trim().replace(/\/+$/, "")
  const anonKey = String(config?.anonKey || "").trim()

  if (!url || !url.startsWith("http")) {
    throw new Error("กรุณากรอก Supabase Project URL ให้ถูกต้อง (เช่น https://xxxx.supabase.co)")
  }
  if (!anonKey) {
    throw new Error("กรุณากรอก Supabase Anon / Public Key")
  }

  const startTime = Date.now()
  const endpoint = `${url}/rest/v1/media_catalog?id=eq.${CATALOG_ROW_ID}&select=id,updated_at,movie_count,series_count`

  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      "apikey": anonKey,
      "Authorization": `Bearer ${anonKey}`,
      "Accept": "application/json"
    }
  })

  const latency = Date.now() - startTime

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "")
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`รหัส API Key ไม่ถูกต้อง หรือไม่มีสิทธิ์เข้าถึง (Status: ${resp.status})`)
    }
    if (resp.status === 404 || errorText.includes("relation \"public.media_catalog\" does not exist")) {
      throw new Error("เชื่อมต่อ Supabase ได้แล้ว แต่ยังไม่พบตาราง 'media_catalog' กรุณากดคัดลอก SQL แล้วไปรันใน SQL Editor ของ Supabase ก่อนครับ")
    }
    throw new Error(`การเชื่อมต่อขัดข้อง: HTTP ${resp.status} - ${errorText.slice(0, 120)}`)
  }

  const data = await resp.json()
  return {
    ok: true,
    latency,
    hasExistingCatalog: Array.isArray(data) && data.length > 0,
    remoteInfo: Array.isArray(data) && data.length > 0 ? data[0] : null
  }
}

/**
 * Push local movies and series catalog to Supabase (Encrypted with AES-256)
 */
export async function pushCatalogToCloud(playlistId) {
  const config = getCloudConfig()
  if (!config.url || !config.anonKey) {
    throw new Error("ยังไม่ได้ตั้งค่าเชื่อมต่อ Supabase Cloud")
  }

  let activeId = playlistId
  if (!activeId) {
    const active = await ensureActiveLibrary()
    activeId = active?._id
  }
  if (!activeId) throw new Error("ไม่พบคลังรายการที่กำลังใช้งาน")

  // 1. Gather all local content
  const movies = await getLibraryMovies(activeId)
  const series = await getLibrarySeries(activeId)

  // Gather details for each series
  const seriesDetailsMap = {}
  for (const s of series) {
    const sid = s.series_id || s.id
    if (sid) {
      const details = await getSeriesDetails(activeId, sid)
      if (details) {
        seriesDetailsMap[sid] = details
      }
    }
  }

  // 2. Encrypt payloads with zero-knowledge AES-256
  const vaultKey = config.vaultKey || DEFAULT_VAULT_KEY
  const moviesEncrypted = await encryptData(movies, vaultKey)
  const seriesEncrypted = await encryptData(series, vaultKey)
  const detailsEncrypted = await encryptData(seriesDetailsMap, vaultKey)

  // 3. Post to Supabase REST endpoint (UPSERT)
  const endpoint = `${config.url}/rest/v1/media_catalog`
  const payload = {
    id: CATALOG_ROW_ID,
    movies_encrypted: moviesEncrypted,
    series_encrypted: seriesEncrypted,
    series_details_encrypted: detailsEncrypted,
    movie_count: movies.length,
    series_count: series.length,
    updated_at: new Date().toISOString()
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "apikey": config.anonKey,
      "Authorization": `Bearer ${config.anonKey}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify(payload)
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "")
    throw new Error(`บันทึกข้อมูลขึ้น Cloud ไม่สำเร็จ: HTTP ${resp.status} - ${errorText.slice(0, 150)}`)
  }

  // Update last synced timestamp
  saveCloudConfig({ lastSyncedAt: Date.now() })

  return {
    success: true,
    movieCount: movies.length,
    seriesCount: series.length,
    timestamp: Date.now()
  }
}

/**
 * Pull catalog from Supabase, decrypt, and update local IndexedDB cache
 */
export async function pullCatalogFromCloud(playlistId) {
  const config = getCloudConfig()
  if (!config.url || !config.anonKey) {
    throw new Error("ยังไม่ได้ตั้งค่าเชื่อมต่อ Supabase Cloud")
  }

  let activeId = playlistId
  if (!activeId) {
    const active = await ensureActiveLibrary()
    activeId = active?._id
  }
  if (!activeId) throw new Error("ไม่พบคลังรายการที่กำลังใช้งาน")

  // 1. Fetch remote encrypted row
  const endpoint = `${config.url}/rest/v1/media_catalog?id=eq.${CATALOG_ROW_ID}&select=*`
  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      "apikey": config.anonKey,
      "Authorization": `Bearer ${config.anonKey}`,
      "Accept": "application/json"
    }
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "")
    throw new Error(`ดึงข้อมูลจาก Cloud ไม่สำเร็จ: HTTP ${resp.status} - ${errText.slice(0, 150)}`)
  }

  const rows = await resp.json()
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("ยังไม่มีข้อมูลแคตตาล็อกบน Cloud (กรุณากด 'อัปเดตข้อมูลขึ้น Cloud' จากคอมพิวเตอร์ก่อนครับ)")
  }

  const catalog = rows[0]
  const vaultKey = config.vaultKey || DEFAULT_VAULT_KEY

  // 2. Decrypt payloads
  let movies = []
  let series = []
  let seriesDetailsMap = {}

  if (catalog.movies_encrypted) {
    movies = (await decryptData(catalog.movies_encrypted, vaultKey)) || []
  }
  if (catalog.series_encrypted) {
    series = (await decryptData(catalog.series_encrypted, vaultKey)) || []
  }
  if (catalog.series_details_encrypted) {
    seriesDetailsMap = (await decryptData(catalog.series_details_encrypted, vaultKey)) || {}
  }

  // 3. Hydrate local IndexedDB cache
  setCached(activeId, "m3u", movies, VOD_TTL)
  setCached(activeId, "series", series, VOD_TTL)

  // Hydrate series details
  for (const [sid, details] of Object.entries(seriesDetailsMap)) {
    setCached(activeId, `series_info_${sid}`, details, VOD_TTL)
  }

  // 4. Dispatch revalidation events so open views update
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: activeId, kind: "m3u" } }))
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: activeId, kind: "series" } }))
  }

  saveCloudConfig({ lastSyncedAt: Date.now() })

  return {
    success: true,
    movieCount: movies.length,
    seriesCount: series.length,
    updatedAt: catalog.updated_at
  }
}

/**
 * Automatically sync on app startup if configured and stale
 */
export async function autoSyncOnStartup() {
  if (typeof window === "undefined") return
  const config = getCloudConfig()
  if (!config.url || !config.anonKey || config.autoSync === false) return

  try {
    const active = await ensureActiveLibrary()
    if (!active?._id) return

    // Quick check remote updated_at
    const endpoint = `${config.url}/rest/v1/media_catalog?id=eq.${CATALOG_ROW_ID}&select=updated_at,movie_count,series_count`
    const resp = await fetch(endpoint, {
      method: "GET",
      headers: {
        "apikey": config.anonKey,
        "Authorization": `Bearer ${config.anonKey}`,
        "Accept": "application/json"
      }
    })

    if (!resp.ok) return
    const rows = await resp.json()
    if (!Array.isArray(rows) || rows.length === 0) return

    const remoteUpdatedAt = new Date(rows[0].updated_at).getTime()
    const lastSynced = config.lastSyncedAt ? Number(config.lastSyncedAt) : 0

    // If remote has newer data or client hasn't synced in 1 hour
    if (remoteUpdatedAt > lastSynced || Date.now() - lastSynced > 60 * 60 * 1000) {
      console.log("[cloud-catalog] Remote catalog is newer, pulling in background...")
      await pullCatalogFromCloud(active._id)
    }
  } catch (err) {
    console.warn("[cloud-catalog] Auto-sync skipped:", err)
  }
}
