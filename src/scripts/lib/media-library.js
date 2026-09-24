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
  const cached = getCached(playlistId, "m3u")
  return Array.isArray(cached?.data) ? [...cached.data] : []
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

  const id = movieData.id ? Number(movieData.id) : Date.now()
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

  const existingIndex = movies.findIndex((m) => Number(m.id) === id)
  if (existingIndex >= 0) {
    movies[existingIndex] = { ...movies[existingIndex], ...formattedMovie }
  } else {
    movies.unshift(formattedMovie)
  }

  setCached(playlistId, "m3u", movies, VOD_TTL)
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "m3u" } }))
    document.dispatchEvent(new CustomEvent("xt:active-changed"))
  }
  return formattedMovie
}

/**
 * Delete a movie from library
 */
export async function deleteMovie(playlistId, movieId) {
  if (!playlistId) throw new Error("No playlist specified")
  const movies = await getLibraryMovies(playlistId)
  const filtered = movies.filter((m) => Number(m.id) !== Number(movieId))
  setCached(playlistId, "m3u", filtered, VOD_TTL)
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "m3u" } }))
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
  const filtered = seriesList.filter((s) => Number(s.id) !== Number(seriesId))
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

  seriesInfo.episodes["1"] = seriesInfo.episodes["1"].filter((e) => Number(e.id) !== Number(episodeId))
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
