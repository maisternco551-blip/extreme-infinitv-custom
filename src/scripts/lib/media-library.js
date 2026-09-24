// Unified media library management for movies, series, and episodes
import { getActiveEntry, getEntries, addEntry, selectEntry } from "@/scripts/lib/creds.js"
import { getCached, setCached, hydrate as hydrateCache } from "@/scripts/lib/cache.js"
import { normalize } from "@/scripts/lib/text.js"

export const VOD_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Ensures there is an active playlist for custom movies and series.
 * Automatically creates a default library playlist if none exists.
 */
export async function ensureActiveLibrary() {
  let active = await getActiveEntry()
  if (active && active._id) return active

  const allEntries = await getEntries()
  if (allEntries && allEntries.length > 0) {
    active = allEntries[0]
    await selectEntry(active._id)
    return active
  }

  // Create default custom media library
  active = await addEntry({
    title: "คลังภาพยนตร์และซีรีส์ (My Media)",
    type: "custom",
    emoji: "🎬"
  })
  return active
}

/**
 * Get all movies in the active library
 */
export async function getLibraryMovies(playlistId) {
  if (!playlistId) return []
  await hydrateCache(playlistId, "m3u")
  await hydrateCache(playlistId, "vod")
  const m3uCached = getCached(playlistId, "m3u")
  const vodCached = getCached(playlistId, "vod")
  const m3uList = Array.isArray(m3uCached?.data) ? m3uCached.data : []
  const vodList = Array.isArray(vodCached?.data) ? vodCached.data : []
  return m3uList.length > 0 ? [...m3uList] : [...vodList]
}

/**
 * Get all series in the active library
 */
export async function getLibrarySeries(playlistId) {
  if (!playlistId) return []
  await hydrateCache(playlistId, "series")
  const cached = getCached(playlistId, "series")
  return Array.isArray(cached?.data) ? [...cached.data] : []
}

/**
 * Get series details and episode list
 */
export async function getSeriesDetails(playlistId, seriesId) {
  if (!playlistId || !seriesId) return null
  const cacheKey = `series_info_${seriesId}`
  await hydrateCache(playlistId, cacheKey)
  const cached = getCached(playlistId, cacheKey)
  return cached?.data || null
}

/**
 * Save (insert or update) a single movie
 */
export async function saveMovie(playlistId, movieData) {
  if (!playlistId) throw new Error("No playlist specified")
  const movies = await getLibraryMovies(playlistId)

  const rawId = movieData.id ?? movieData.stream_id
  const id = rawId ? (isNaN(Number(rawId)) ? rawId : Number(rawId)) : Date.now()
  const name = String(movieData.name || "").trim()
  const year = (name.match(/\((\d{4})\)/) || [])[1] || String(movieData.year || "").trim()

  const formattedMovie = {
    id,
    stream_id: id,
    name,
    logo: movieData.logo || movieData.image || null,
    year,
    rating: movieData.rating || "8.5",
    duration: movieData.duration || "",
    category: movieData.category || "ภาพยนตร์",
    plot: movieData.plot || name,
    added: movieData.added || Date.now(),
    norm: normalize(`${name} ${movieData.category || ""} ${year}`),
    url: movieData.url || movieData.directUrl || "",
    directUrl: movieData.url || movieData.directUrl || "",
    referer: movieData.referer || ""
  }

  const existingIndex = movies.findIndex((m) => {
    const mId = m.id ?? m.stream_id
    return String(mId) === String(id) || (id && Number(mId) === Number(id))
  })
  if (existingIndex >= 0) {
    movies[existingIndex] = { ...movies[existingIndex], ...formattedMovie }
  } else {
    movies.unshift(formattedMovie)
  }

  setCached(playlistId, "m3u", movies, VOD_TTL)

  // Also sync to vod cache if present
  const vodCached = getCached(playlistId, "vod")
  if (Array.isArray(vodCached?.data)) {
    const vodIdx = vodCached.data.findIndex((m) => {
      const mId = m.id ?? m.stream_id
      return String(mId) === String(id) || (id && Number(mId) === Number(id))
    })
    if (vodIdx >= 0) {
      vodCached.data[vodIdx] = { ...vodCached.data[vodIdx], ...formattedMovie }
    } else {
      vodCached.data.unshift(formattedMovie)
    }
    setCached(playlistId, "vod", vodCached.data, VOD_TTL)
  }

  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "m3u" } }))
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "vod" } }))
    document.dispatchEvent(new CustomEvent("xt:active-changed"))
  }
  return formattedMovie
}

/**
 * Delete a movie from library
 */
export async function deleteMovie(playlistId, movieId, movieName = "") {
  if (!playlistId) throw new Error("No playlist specified")
  await hydrateCache(playlistId, "m3u")
  await hydrateCache(playlistId, "vod")

  const targetIdStr = movieId != null ? String(movieId).trim() : ""
  const targetName = movieName ? movieName.trim().toLowerCase() : ""

  const filterFn = (m) => {
    const idStr = m.id != null ? String(m.id).trim() : ""
    const streamIdStr = m.stream_id != null ? String(m.stream_id).trim() : ""

    // Match by ID or stream_id string equality
    if (targetIdStr && (idStr === targetIdStr || streamIdStr === targetIdStr)) {
      return false
    }
    // Match by numeric comparison if both are valid numbers
    if (targetIdStr && !isNaN(Number(targetIdStr))) {
      const numTarget = Number(targetIdStr)
      if (Number(m.id) === numTarget || Number(m.stream_id) === numTarget) {
        return false
      }
    }
    // Fallback match by exact movie name
    if (targetName && (m.name || "").trim().toLowerCase() === targetName) {
      return false
    }
    return true
  }

  const m3uCached = getCached(playlistId, "m3u")
  if (Array.isArray(m3uCached?.data)) {
    const filteredM3u = m3uCached.data.filter(filterFn)
    setCached(playlistId, "m3u", filteredM3u, VOD_TTL)
  }

  const vodCached = getCached(playlistId, "vod")
  if (Array.isArray(vodCached?.data)) {
    const filteredVod = vodCached.data.filter(filterFn)
    setCached(playlistId, "vod", filteredVod, VOD_TTL)
  }

  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "m3u" } }))
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "vod" } }))
    document.dispatchEvent(new CustomEvent("xt:active-changed"))
  }
  return true
}

/**
 * Save (insert or update) a series
 */
export async function saveSeries(playlistId, seriesData) {
  if (!playlistId) throw new Error("No playlist specified")
  const seriesList = await getLibrarySeries(playlistId)

  const id = seriesData.id ? Number(seriesData.id) : Date.now()
  const name = String(seriesData.name || "").trim()
  const year = (name.match(/\((\d{4})\)/) || [])[1] || String(seriesData.year || "").trim()

  const formattedSeries = {
    id,
    series_id: id,
    name,
    logo: seriesData.logo || seriesData.image || null,
    year,
    rating: seriesData.rating || "8.8",
    category: seriesData.category || "ซีรีส์",
    plot: seriesData.plot || name,
    added: seriesData.added || Date.now(),
    norm: normalize(`${name} ซีรีส์ ${year}`),
    isW3uSeries: true
  }

  const existingIndex = seriesList.findIndex((s) => Number(s.id) === id)
  if (existingIndex >= 0) {
    seriesList[existingIndex] = { ...seriesList[existingIndex], ...formattedSeries }
  } else {
    seriesList.unshift(formattedSeries)
  }

  setCached(playlistId, "series", seriesList, VOD_TTL)

  // Ensure series_info exists
  const existingInfo = await getSeriesDetails(playlistId, id)
  if (!existingInfo) {
    const defaultInfo = {
      info: {
        name,
        cover: formattedSeries.logo,
        plot: name,
        rating: "8.8",
        releaseDate: year || "2026",
        category_name: formattedSeries.category
      },
      seasons: [
        {
          season_number: 1,
          name: "Season 1",
          episode_count: 0
        }
      ],
      episodes: {
        "1": []
      }
    }
    setCached(playlistId, `series_info_${id}`, defaultInfo, VOD_TTL)
  }

  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "series" } }))
    document.dispatchEvent(new CustomEvent("xt:active-changed"))
  }
  return formattedSeries
}

/**
 * Delete a series and its info from library
 */
export async function deleteSeries(playlistId, seriesId) {
  if (!playlistId) throw new Error("No playlist specified")
  const seriesList = await getLibrarySeries(playlistId)
  const targetIdStr = seriesId != null ? String(seriesId).trim() : ""
  const filtered = seriesList.filter((s) => {
    const sId = s.id ?? s.series_id
    const sIdStr = sId != null ? String(sId).trim() : ""
    if (targetIdStr && sIdStr === targetIdStr) return false
    if (targetIdStr && !isNaN(Number(targetIdStr)) && Number(sId) === Number(targetIdStr)) return false
    return true
  })
  setCached(playlistId, "series", filtered, VOD_TTL)

  // Invalidate series info
  setCached(playlistId, `series_info_${seriesId}`, null, 0)

  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "series" } }))
    document.dispatchEvent(new CustomEvent("xt:active-changed"))
  }
  return true
}

/**
 * Add or update an episode in a series
 */
export async function saveEpisode(playlistId, seriesId, episodeData) {
  if (!playlistId || !seriesId) throw new Error("Missing playlist or series ID")
  let seriesInfo = await getSeriesDetails(playlistId, seriesId)
  if (!seriesInfo) {
    seriesInfo = {
      info: { name: "ซีรีส์" },
      seasons: [{ season_number: 1, name: "Season 1", episode_count: 0 }],
      episodes: { "1": [] }
    }
  }

  if (!seriesInfo.episodes) seriesInfo.episodes = { "1": [] }
  if (!seriesInfo.episodes["1"]) seriesInfo.episodes["1"] = []

  const season1Episodes = seriesInfo.episodes["1"]
  const epId = episodeData.id ? Number(episodeData.id) : Date.now()
  const epNum = episodeData.episode_num != null ? Number(episodeData.episode_num) : season1Episodes.length + 1

  const formattedEpisode = {
    id: epId,
    episode_num: epNum,
    title: episodeData.title || episodeData.name || `EP.${epNum}`,
    season: 1,
    container_extension: "m3u8",
    _directUrl: episodeData.url || episodeData._directUrl || "",
    url: episodeData.url || episodeData._directUrl || "",
    referer: episodeData.referer || "",
    info: episodeData.info || ""
  }

  const existingIndex = season1Episodes.findIndex((e) => Number(e.id) === epId || Number(e.episode_num) === epNum)
  if (existingIndex >= 0) {
    season1Episodes[existingIndex] = { ...season1Episodes[existingIndex], ...formattedEpisode }
  } else {
    season1Episodes.push(formattedEpisode)
  }

  // Sort by episode_num
  season1Episodes.sort((a, b) => (Number(a.episode_num) || 0) - (Number(b.episode_num) || 0))

  if (seriesInfo.seasons && seriesInfo.seasons[0]) {
    seriesInfo.seasons[0].episode_count = season1Episodes.length
  }

  setCached(playlistId, `series_info_${seriesId}`, seriesInfo, VOD_TTL)
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: `series_info_${seriesId}` } }))
  }
  return formattedEpisode
}

/**
 * Delete an episode from a series
 */
export async function deleteEpisode(playlistId, seriesId, episodeId) {
  if (!playlistId || !seriesId) throw new Error("Missing playlist or series ID")
  const seriesInfo = await getSeriesDetails(playlistId, seriesId)
  if (!seriesInfo || !seriesInfo.episodes || !seriesInfo.episodes["1"]) return false

  const targetEpIdStr = episodeId != null ? String(episodeId).trim() : ""
  seriesInfo.episodes["1"] = seriesInfo.episodes["1"].filter((e) => {
    const eIdStr = e.id != null ? String(e.id).trim() : ""
    if (targetEpIdStr && eIdStr === targetEpIdStr) return false
    if (targetEpIdStr && !isNaN(Number(targetEpIdStr)) && Number(e.id) === Number(targetEpIdStr)) return false
    return true
  })
  if (seriesInfo.seasons && seriesInfo.seasons[0]) {
    seriesInfo.seasons[0].episode_count = seriesInfo.episodes["1"].length
  }

  setCached(playlistId, `series_info_${seriesId}`, seriesInfo, VOD_TTL)
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: `series_info_${seriesId}` } }))
  }
  return true
}

/**
 * Export full library as JSON
 */
export async function exportLibrary(playlistId) {
  const movies = await getLibraryMovies(playlistId)
  const series = await getLibrarySeries(playlistId)
  const seriesDetails = {}

  for (const s of series) {
    const details = await getSeriesDetails(playlistId, s.id)
    if (details) seriesDetails[s.id] = details
  }

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    movies,
    series,
    seriesDetails
  }
}

/**
 * Robust brace matching to extract all top-level { ... } objects from text
 */
export function extractTopLevelObjects(text) {
  const objects = []
  let depth = 0
  let start = -1
  let inString = false
  let quoteChar = ""
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (char === "\\") {
      escape = true
      continue
    }
    if (!inString && (char === '"' || char === "'" || char === "`")) {
      inString = true
      quoteChar = char
      continue
    }
    if (inString && char === quoteChar) {
      inString = false
      continue
    }
    if (!inString) {
      if (char === "{") {
        if (depth === 0) start = i
        depth++
      } else if (char === "}") {
        depth--
        if (depth === 0 && start !== -1) {
          const chunk = text.slice(start, i + 1)
          try {
            const obj = new Function(`"use strict"; return (${chunk});`)()
            if (obj && typeof obj === "object") objects.push(obj)
          } catch (e) {}
          start = -1
        }
      }
    }
  }
  return objects
}

/**
 * Universal loose code parser supporting multiple movies, series, arrays, and objects
 */
export function parseLooseMediaCode(text) {
  if (!text || !text.trim()) {
    return { movies: [], series: [], error: null }
  }

  const raw = text.trim()
  let rawItems = []

  // Method 1: Direct JSON parse
  try {
    const direct = JSON.parse(raw)
    rawItems = Array.isArray(direct) ? direct : [direct]
  } catch (_) {
    // Method 2: Bracket wrap and comma fix
    try {
      let wrapped = raw
      if (!wrapped.startsWith("[")) {
        wrapped = wrapped.replace(/\}\s*\{/g, "},\n{")
        wrapped = wrapped.replace(/,\s*$/, "")
        wrapped = "[" + wrapped + "]"
      }
      const fn = new Function(`"use strict"; return (${wrapped});`)
      const res = fn()
      rawItems = Array.isArray(res) ? res : [res]
    } catch (_2) {
      rawItems = extractTopLevelObjects(raw)
    }
  }

  if (!rawItems || rawItems.length === 0) {
    rawItems = extractTopLevelObjects(raw)
  }

  if (!rawItems || rawItems.length === 0) {
    return { movies: [], series: [], error: "ไม่พบข้อมูลที่อ่านได้ กรุณาตรวจสอบรูปแบบโค้ด" }
  }

  const detectedMovies = []
  const detectedSeries = []

  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue

    if (Array.isArray(item.stations) && item.stations.length > 0) {
      const validStations = item.stations.filter((st) => st && (st.url || st.link))
      if (validStations.length > 0) {
        const isEpisodeSeries = validStations.some((st) => {
          const n = String(st.name || "").trim().toLowerCase()
          return /^(ep|ตอน|e\d|s\d|part|ch)/i.test(n) || n.includes("ep.") || n.includes("ep ")
        })

        if (isEpisodeSeries) {
          detectedSeries.push({
            name: String(item.name || item.title || "ซีรีส์ไม่มีชื่อ").trim(),
            image: item.image || item.logo || item.cover || "",
            category: item.category || "ซีรีส์",
            referer: item.referer || "",
            stations: validStations
          })
        } else {
          for (const st of validStations) {
            detectedMovies.push({
              name: String(st.name || st.title || "ภาพยนตร์ไม่มีชื่อ").trim(),
              image: st.image || st.logo || item.image || item.logo || "",
              url: st.url || st.link,
              category: st.category || item.category || "ภาพยนตร์",
              referer: st.referer || item.referer || ""
            })
          }
        }
      }
    } else if (Array.isArray(item.movies) && item.movies.length > 0) {
      for (const m of item.movies) {
        if (m && (m.url || m.link)) {
          detectedMovies.push({
            name: String(m.name || m.title || "ภาพยนตร์ไม่มีชื่อ").trim(),
            image: m.image || m.logo || m.cover || "",
            url: m.url || m.link,
            category: m.category || item.category || "ภาพยนตร์",
            referer: m.referer || item.referer || ""
          })
        }
      }
    } else if (item.url || item.link) {
      detectedMovies.push({
        name: String(item.name || item.title || "ภาพยนตร์ไม่มีชื่อ").trim(),
        image: item.image || item.logo || item.cover || "",
        url: item.url || item.link,
        category: item.category || "ภาพยนตร์",
        referer: item.referer || ""
      })
    }
  }

  return { movies: detectedMovies, series: detectedSeries, error: null }
}
