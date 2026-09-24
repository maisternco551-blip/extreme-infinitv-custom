<script>
  import { onMount } from "svelte"
  import { isAuthenticated, verifyPin, changePin, logout } from "@/scripts/lib/admin-auth.js"
  import {
    ensureActiveLibrary,
    getLibraryMovies,
    getLibrarySeries,
    getSeriesDetails,
    saveMovie,
    deleteMovie,
    saveSeries,
    deleteSeries,
    saveEpisode,
    deleteEpisode,
    exportLibrary,
    parseLooseMediaCode,
    VOD_TTL
  } from "@/scripts/lib/media-library.js"
  import { setCached } from "@/scripts/lib/cache.js"
  import { normalize } from "@/scripts/lib/text.js"

  // Auth State
  let authed = $state(false)
  let pinInput = $state("")
  let pinError = $state("")

  // Active Library State
  let activeLibrary = $state(null)
  let activeTab = $state("dashboard") // dashboard | import | movies | series | settings
  let isLoading = $state(true)

  // Catalog State
  let movies = $state([])
  let seriesList = $state([])
  let movieSearch = $state("")
  let seriesSearch = $state("")

  // Series Episode Editor State
  let selectedSeries = $state(null)
  let selectedSeriesInfo = $state(null)
  let isEditingEpisodes = $state(false)

  // Modals & Forms
  let showMovieModal = $state(false)
  let movieForm = $state({ id: null, name: "", logo: "", url: "", referer: "", category: "ภาพยนตร์", year: "" })

  let showSeriesModal = $state(false)
  let seriesForm = $state({ id: null, name: "", logo: "", category: "ซีรีส์", year: "" })

  let showEpisodeModal = $state(false)
  let episodeForm = $state({ id: null, episode_num: 1, title: "", url: "", referer: "" })

  // Smart Importer State inside Admin
  let rawImportCode = $state("")
  let importParseResult = $state({ movies: [], series: [], error: null })
  let importStatus = $state({ text: "", type: "" })
  let isImporting = $state(false)

  // PIN Change State
  let currentPin = $state("")
  let newPin = $state("")
  let confirmPin = $state("")
  let pinChangeStatus = $state({ text: "", type: "" })

  // Toast notification
  let toast = $state({ text: "", type: "", show: false })

  function showToast(text, type = "success") {
    toast = { text, type, show: true }
    setTimeout(() => { toast.show = false }, 3000)
  }

  // --- Auth logic ---
  async function handleUnlock() {
    pinError = ""
    if (!pinInput) {
      pinError = "กรุณาใส่รหัส PIN"
      return
    }
    const ok = await verifyPin(pinInput)
    if (ok) {
      authed = true
      pinInput = ""
      await loadData()
    } else {
      pinError = "รหัส PIN ไม่ถูกต้อง (รหัสเริ่มต้นคือ 1234)"
      pinInput = ""
    }
  }

  function handleKeypad(num) {
    if (pinInput.length < 8) {
      pinInput += String(num)
    }
  }

  function handleBackspace() {
    pinInput = pinInput.slice(0, -1)
  }

  function handleClear() {
    pinInput = ""
    pinError = ""
  }

  function handleLogout() {
    logout()
    authed = false
    pinInput = ""
  }

  // --- Data Loading ---
  async function loadData() {
    isLoading = true
    try {
      activeLibrary = await ensureActiveLibrary()
      if (activeLibrary && activeLibrary._id) {
        movies = await getLibraryMovies(activeLibrary._id)
        seriesList = await getLibrarySeries(activeLibrary._id)
      }
    } catch (e) {
      console.error("Load error:", e)
      showToast("เกิดข้อผิดพลาดในการโหลดข้อมูล: " + e.message, "error")
    } finally {
      isLoading = false
    }
  }

  // Calculate total episodes
  let totalEpisodesCount = $state(0)
  async function calculateTotalEpisodes() {
    if (!activeLibrary || !seriesList.length) {
      totalEpisodesCount = 0
      return
    }
    let count = 0
    for (const s of seriesList) {
      const details = await getSeriesDetails(activeLibrary._id, s.id)
      if (details?.episodes?.["1"]) {
        count += details.episodes["1"].length
      }
    }
    totalEpisodesCount = count
  }

  $effect(() => {
    if (seriesList.length && authed) {
      calculateTotalEpisodes()
    }
  })

  // Filtered views
  let filteredMovies = $derived(
    movies.filter((m) => {
      if (!movieSearch.trim()) return true
      const q = movieSearch.toLowerCase()
      return (m.name || "").toLowerCase().includes(q) || (m.category || "").toLowerCase().includes(q)
    })
  )

  let filteredSeries = $derived(
    seriesList.filter((s) => {
      if (!seriesSearch.trim()) return true
      const q = seriesSearch.toLowerCase()
      return (s.name || "").toLowerCase().includes(q) || (s.category || "").toLowerCase().includes(q)
    })
  )

  // --- Movie Operations ---
  function openAddMovie() {
    movieForm = { id: null, name: "", logo: "", url: "", referer: "", category: "ภาพยนตร์", year: new Date().getFullYear().toString() }
    showMovieModal = true
  }

  function openEditMovie(m) {
    movieForm = {
      id: m.id,
      name: m.name || "",
      logo: m.logo || "",
      url: m.url || m.directUrl || "",
      referer: m.referer || "",
      category: m.category || "ภาพยนตร์",
      year: m.year || ""
    }
    showMovieModal = true
  }

  async function handleSaveMovie() {
    if (!movieForm.name.trim() || !movieForm.url.trim()) {
      showToast("กรุณากรอกชื่อหนังและลิงก์วิดีโอสตรีม", "error")
      return
    }
    try {
      await saveMovie(activeLibrary._id, movieForm)
      movies = await getLibraryMovies(activeLibrary._id)
      showMovieModal = false
      showToast("บันทึกข้อมูลภาพยนตร์เรียบร้อยแล้ว!")
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error")
    }
  }

  async function handleDeleteMovie(id, name) {
    if (!confirm(`คุณต้องการลบภาพยนตร์เรื่อง "${name}" ใช่หรือไม่?`)) return
    try {
      await deleteMovie(activeLibrary._id, id)
      movies = await getLibraryMovies(activeLibrary._id)
      showToast(`ลบภาพยนตร์ "${name}" เรียบร้อยแล้ว`)
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error")
    }
  }

  // --- Series Operations ---
  function openAddSeries() {
    seriesForm = { id: null, name: "", logo: "", category: "ซีรีส์", year: new Date().getFullYear().toString() }
    showSeriesModal = true
  }

  function openEditSeries(s) {
    seriesForm = {
      id: s.id,
      name: s.name || "",
      logo: s.logo || "",
      category: s.category || "ซีรีส์",
      year: s.year || ""
    }
    showSeriesModal = true
  }

  async function handleSaveSeries() {
    if (!seriesForm.name.trim()) {
      showToast("กรุณากรอกชื่อซีรีส์", "error")
      return
    }
    try {
      await saveSeries(activeLibrary._id, seriesForm)
      seriesList = await getLibrarySeries(activeLibrary._id)
      showSeriesModal = false
      showToast("บันทึกข้อมูลซีรีส์เรียบร้อยแล้ว!")
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error")
    }
  }

  async function handleDeleteSeries(id, name) {
    if (!confirm(`คุณต้องการลบซีรีส์เรื่อง "${name}" พร้อมทุกตอนใช่หรือไม่?`)) return
    try {
      await deleteSeries(activeLibrary._id, id)
      seriesList = await getLibrarySeries(activeLibrary._id)
      if (selectedSeries && selectedSeries.id === id) {
        isEditingEpisodes = false
        selectedSeries = null
      }
      showToast(`ลบซีรีส์ "${name}" เรียบร้อยแล้ว`)
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error")
    }
  }

  // --- Episode Operations ---
  async function openEpisodeManager(s) {
    selectedSeries = s
    selectedSeriesInfo = await getSeriesDetails(activeLibrary._id, s.id)
    isEditingEpisodes = true
  }

  function openAddEpisode() {
    const currentEps = selectedSeriesInfo?.episodes?.["1"] || []
    const nextEpNum = currentEps.length + 1
    episodeForm = {
      id: null,
      episode_num: nextEpNum,
      title: `EP.${nextEpNum}`,
      url: "",
      referer: ""
    }
    showEpisodeModal = true
  }

  function openEditEpisode(ep) {
    episodeForm = {
      id: ep.id,
      episode_num: ep.episode_num,
      title: ep.title || `EP.${ep.episode_num}`,
      url: ep.url || ep._directUrl || "",
      referer: ep.referer || ""
    }
    showEpisodeModal = true
  }

  async function handleSaveEpisode() {
    if (!episodeForm.url.trim()) {
      showToast("กรุณาใส่ลิงก์สตรีมวิดีโอ (.m3u8/.mp4)", "error")
      return
    }
    try {
      await saveEpisode(activeLibrary._id, selectedSeries.id, episodeForm)
      selectedSeriesInfo = await getSeriesDetails(activeLibrary._id, selectedSeries.id)
      await calculateTotalEpisodes()
      showEpisodeModal = false
      showToast("บันทึกข้อมูลตอนเรียบร้อยแล้ว!")
    } catch (e) {
      showToast("บันทึกตอนไม่สำเร็จ: " + e.message, "error")
    }
  }

  async function handleDeleteEpisode(epId, epTitle) {
    if (!confirm(`ต้องการลบ "${epTitle}" ใช่หรือไม่?`)) return
    try {
      await deleteEpisode(activeLibrary._id, selectedSeries.id, epId)
      selectedSeriesInfo = await getSeriesDetails(activeLibrary._id, selectedSeries.id)
      await calculateTotalEpisodes()
      showToast(`ลบ "${epTitle}" เรียบร้อยแล้ว`)
    } catch (e) {
      showToast("ลบตอนไม่สำเร็จ: " + e.message, "error")
    }
  }

  // --- Smart Importer Logic ---
  function handleImportInput() {
    importParseResult = parseLooseMediaCode(rawImportCode)
    importStatus = { text: "", type: "" }
  }

  async function executeAdminImport() {
    if (!importParseResult.movies.length && !importParseResult.series.length) {
      importStatus = { text: "กรุณาวางโค้ดที่มีหนังหรือซีรีส์ก่อนกดยืนยัน", type: "error" }
      return
    }

    isImporting = true
    importStatus = { text: "กำลังนำเข้าข้อมูลลงสู่คลัง...", type: "info" }

    try {
      const lib = await ensureActiveLibrary()
      const playlistId = lib._id

      // 1. Process Movies
      if (importParseResult.movies.length > 0) {
        const curMovies = await getLibraryMovies(playlistId)
        for (let i = 0; i < importParseResult.movies.length; i++) {
          const m = importParseResult.movies[i]
          const id = Date.now() + i
          const year = (m.name.match(/\((\d{4})\)/) || [])[1] || ""
          curMovies.unshift({
            id,
            stream_id: id,
            name: m.name,
            logo: m.image || null,
            year,
            rating: "8.5",
            duration: "",
            category: m.category || "ภาพยนตร์",
            plot: m.name,
            added: Date.now(),
            norm: normalize(`${m.name} ${m.category || ""} ${year}`),
            url: m.url,
            directUrl: m.url,
            referer: m.referer || ""
          })
        }
        setCached(playlistId, "m3u", curMovies, VOD_TTL)
      }

      // 2. Process Series
      if (importParseResult.series.length > 0) {
        const curSeries = await getLibrarySeries(playlistId)
        for (let i = 0; i < importParseResult.series.length; i++) {
          const s = importParseResult.series[i]
          const seriesId = Date.now() + 1000 + i
          const year = (s.name.match(/\((\d{4})\)/) || [])[1] || ""

          const eps = (s.stations || []).map((st, epIdx) => ({
            id: seriesId + 100 + epIdx,
            episode_num: epIdx + 1,
            title: st.name || `EP.${epIdx + 1}`,
            season: 1,
            container_extension: "m3u8",
            _directUrl: st.url,
            url: st.url,
            referer: st.referer || s.referer || "",
            info: st.info || ""
          }))

          const seriesInfoData = {
            info: {
              name: s.name,
              cover: s.image,
              plot: s.name,
              rating: "8.8",
              releaseDate: year || "2026",
              category_name: "ซีรีส์"
            },
            seasons: [{ season_number: 1, name: "Season 1", episode_count: eps.length }],
            episodes: { "1": eps }
          }

          setCached(playlistId, `series_info_${seriesId}`, seriesInfoData, VOD_TTL)

          curSeries.unshift({
            id: seriesId,
            series_id: seriesId,
            name: s.name,
            logo: s.image || null,
            year,
            rating: "8.8",
            category: "ซีรีส์",
            plot: s.name,
            added: Date.now(),
            norm: normalize(`${s.name} ซีรีส์ ${year}`),
            isW3uSeries: true
          })
        }
        setCached(playlistId, "series", curSeries, VOD_TTL)
      }

      if (typeof document !== "undefined") {
        document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "m3u" } }))
        document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "series" } }))
        document.dispatchEvent(new CustomEvent("xt:active-changed"))
      }

      importStatus = {
        text: `🎉 นำเข้าสำเร็จเรียบร้อย! (${importParseResult.movies.length} หนัง, ${importParseResult.series.length} ซีรีส์)`,
        type: "success"
      }

      await loadData()
      setTimeout(() => {
        rawImportCode = ""
        importParseResult = { movies: [], series: [], error: null }
        isImporting = false
      }, 1500)

    } catch (e) {
      importStatus = { text: "เกิดข้อผิดพลาดในการบันทึก: " + e.message, type: "error" }
      isImporting = false
    }
  }

  // --- Backup & Export ---
  async function handleExport() {
    try {
      const data = await exportLibrary(activeLibrary._id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `infinitv_backup_${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast("ส่งออกไฟล์สำรองข้อมูลสำเร็จ!")
    } catch (e) {
      showToast("ส่งออกไม่สำเร็จ: " + e.message, "error")
    }
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const content = evt.target.result
        const parsed = JSON.parse(content)
        if (!parsed.movies && !parsed.series) {
          showToast("ไฟล์สำรองข้อมูลไม่ถูกต้อง", "error")
          return
        }

        const playlistId = activeLibrary._id
        if (Array.isArray(parsed.movies)) {
          setCached(playlistId, "m3u", parsed.movies, VOD_TTL)
        }
        if (Array.isArray(parsed.series)) {
          setCached(playlistId, "series", parsed.series, VOD_TTL)
        }
        if (parsed.seriesDetails) {
          for (const [id, det] of Object.entries(parsed.seriesDetails)) {
            setCached(playlistId, `series_info_${id}`, det, VOD_TTL)
          }
        }

        if (typeof document !== "undefined") {
          document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "m3u" } }))
          document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "series" } }))
          document.dispatchEvent(new CustomEvent("xt:active-changed"))
        }

        await loadData()
        showToast("กู้คืนข้อมูลจากไฟล์สำรองสำเร็จเรียบร้อย!")
      } catch (err) {
        showToast("เกิดข้อผิดพลาดในการอ่านไฟล์: " + err.message, "error")
      }
    }
    reader.readAsText(file)
  }

  // --- Change PIN ---
  async function handleChangePin() {
    pinChangeStatus = { text: "", type: "" }
    if (!currentPin) {
      pinChangeStatus = { text: "กรุณาใส่รหัส PIN เดิม", type: "error" }
      return
    }
    if (newPin.length < 4) {
      pinChangeStatus = { text: "รหัส PIN ใหม่ต้องมีความยาวอย่างน้อย 4 หลัก", type: "error" }
      return
    }
    if (newPin !== confirmPin) {
      pinChangeStatus = { text: "รหัส PIN ใหม่และการยืนยันไม่ตรงกัน", type: "error" }
      return
    }

    const res = await changePin(currentPin, newPin)
    if (res.success) {
      pinChangeStatus = { text: "🎉 เปลี่ยนรหัส PIN สำเร็จเรียบร้อย!", type: "success" }
      currentPin = ""
      newPin = ""
      confirmPin = ""
    } else {
      pinChangeStatus = { text: res.error || "เปลี่ยนรหัส PIN ไม่สำเร็จ", type: "error" }
    }
  }

  onMount(() => {
    authed = isAuthenticated()
    if (authed) {
      loadData()
    }
  })
</script>

<!-- Toast Notification -->
{#if toast.show}
  <div class="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl transition-all duration-300
    {toast.type === 'error' ? 'bg-red-500/20 text-red-200 border border-red-500/50' : 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/50'} backdrop-blur-md">
    <span>{toast.text}</span>
  </div>
{/if}

<!-- 1. LOCK SCREEN (PIN KEYPAD) -->
{#if !authed}
  <div class="min-h-screen bg-[#07090e] text-white flex flex-col items-center justify-center p-4 selection:bg-[#e8590c]/30">
    <div class="w-full max-w-md bg-[#0f131a] border border-[#1e2638] rounded-3xl p-8 shadow-2xl flex flex-col items-center relative overflow-hidden">
      <!-- Glow effect -->
      <div class="absolute -top-24 -left-24 w-48 h-48 bg-[#e8590c]/10 rounded-full blur-3xl pointer-events-none"></div>

      <!-- Lock Icon -->
      <div class="w-16 h-16 rounded-2xl bg-[#e8590c]/15 border border-[#e8590c]/30 flex items-center justify-center mb-6 text-[#f97316] shadow-lg shadow-[#e8590c]/10">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>

      <h1 class="text-2xl font-bold tracking-tight text-white mb-2">ระบบจัดการหลังบ้าน</h1>
      <p class="text-xs text-gray-400 mb-6 text-center">ใส่รหัส PIN เพื่อเข้าสู่ระบบ (รหัสเริ่มต้น: <strong class="text-orange-400">1234</strong>)</p>

      <!-- PIN Display Dots -->
      <div class="flex items-center gap-3 mb-6">
        {#each [0, 1, 2, 3] as idx}
          <div class="w-4 h-4 rounded-full border-2 transition-all duration-200 {idx < pinInput.length ? 'bg-[#e8590c] border-[#e8590c] scale-110 shadow-md shadow-[#e8590c]/50' : 'border-[#2d3748] bg-[#161b26]'}"></div>
        {/each}
      </div>

      <!-- PIN Input field for hardware keyboard / TV remote typing -->
      <form onsubmit={(e) => { e.preventDefault(); handleUnlock(); }} class="w-full mb-6">
        <input
          type="password"
          bind:value={pinInput}
          placeholder="พิมพ์รหัส PIN ที่นี่..."
          maxlength="8"
          class="w-full text-center tracking-[0.5em] text-lg py-2.5 px-4 bg-[#141923] border border-[#232b3e] rounded-xl text-white focus:outline-none focus:border-[#e8590c] transition-colors"
          autofocus
        />
      </form>

      {#if pinError}
        <div class="text-xs text-red-400 mb-4 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-center w-full animate-shake">
          {pinError}
        </div>
      {/if}

      <!-- Numeric Keypad for mouse, touch and TV remote -->
      <div class="grid grid-cols-3 gap-3 w-full max-w-[280px] mb-6">
        {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as num}
          <button
            type="button"
            onclick={() => handleKeypad(num)}
            class="h-14 rounded-2xl bg-[#151b27] hover:bg-[#1e2638] active:scale-95 border border-[#232c40] text-xl font-semibold text-white transition-all cursor-pointer">
            {num}
          </button>
        {/each}
        <button
          type="button"
          onclick={handleClear}
          class="h-14 rounded-2xl bg-[#151b27] hover:bg-[#1e2638] active:scale-95 border border-[#232c40] text-sm font-semibold text-gray-400 transition-all cursor-pointer">
          C
        </button>
        <button
          type="button"
          onclick={() => handleKeypad(0)}
          class="h-14 rounded-2xl bg-[#151b27] hover:bg-[#1e2638] active:scale-95 border border-[#232c40] text-xl font-semibold text-white transition-all cursor-pointer">
          0
        </button>
        <button
          type="button"
          onclick={handleBackspace}
          aria-label="ลบตัวเลข"
          class="h-14 rounded-2xl bg-[#151b27] hover:bg-[#1e2638] active:scale-95 border border-[#232c40] flex items-center justify-center text-gray-400 transition-all cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
        </button>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col gap-2 w-full">
        <button
          type="button"
          onclick={handleUnlock}
          class="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#e8590c] to-[#f97316] hover:brightness-110 font-bold text-white shadow-lg shadow-[#e8590c]/25 active:scale-[0.98] transition-all cursor-pointer">
          ปลดล็อคเข้าสู่หลังบ้าน
        </button>

        <a
          href="/"
          class="w-full py-2.5 px-4 rounded-xl text-center text-sm font-medium text-gray-400 hover:text-white hover:bg-[#161c28] transition-colors cursor-pointer no-underline">
          ← กลับสู่หน้าโชว์ (ผู้ชมทั่วไป)
        </a>
      </div>
    </div>
  </div>

<!-- 2. ADMIN PORTAL (DASHBOARD & MANAGEMENT) -->
{:else}
  <div class="min-h-screen bg-[#07090e] text-gray-100 flex flex-col font-sans selection:bg-[#e8590c]/30">
    <!-- Top Navigation Bar -->
    <header class="h-16 border-b border-[#1b2234] bg-[#0c0f17]/90 backdrop-blur-md px-4 md:px-8 flex items-center justify-between sticky top-0 z-30">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-[#e8590c] to-[#ff6b6b] flex items-center justify-center text-white shadow-md shadow-[#e8590c]/20">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </div>
        <div>
          <h1 class="text-base font-bold tracking-tight text-white flex items-center gap-2">
            Extreme InfiniTV
            <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#e8590c]/20 text-[#f97316] border border-[#e8590c]/30">Admin Backoffice</span>
          </h1>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a
          href="/"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#252e42] bg-[#121622] hover:bg-[#1a2130] text-xs font-semibold text-gray-300 transition-colors no-underline">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span class="hidden sm:inline">ดูหน้าโชว์</span>
        </a>

        <button
          type="button"
          onclick={handleLogout}
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-xs font-semibold text-red-400 transition-colors cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span class="hidden sm:inline">ล็อคหลังบ้าน</span>
        </button>
      </div>
    </header>

    <!-- Main Admin Container -->
    <div class="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-6">

      <!-- Navigation Tabs -->
      <nav class="flex items-center gap-2 p-1.5 bg-[#0f131d] border border-[#1d2538] rounded-2xl overflow-x-auto custom-scroll shrink-0">
        <button
          type="button"
          onclick={() => { activeTab = "dashboard"; isEditingEpisodes = false; }}
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap {activeTab === 'dashboard' ? 'bg-[#e8590c] text-white shadow-lg shadow-[#e8590c]/25' : 'text-gray-400 hover:text-white hover:bg-[#171e2e]'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          ภาพรวม (Dashboard)
        </button>

        <button
          type="button"
          onclick={() => { activeTab = "import"; isEditingEpisodes = false; }}
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap {activeTab === 'import' ? 'bg-[#e8590c] text-white shadow-lg shadow-[#e8590c]/25' : 'text-gray-400 hover:text-white hover:bg-[#171e2e]'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          วางโค้ดนำเข้า (Smart Importer)
        </button>

        <button
          type="button"
          onclick={() => { activeTab = "movies"; isEditingEpisodes = false; }}
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap {activeTab === 'movies' ? 'bg-[#e8590c] text-white shadow-lg shadow-[#e8590c]/25' : 'text-gray-400 hover:text-white hover:bg-[#171e2e]'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
          จัดการภาพยนตร์ ({movies.length})
        </button>

        <button
          type="button"
          onclick={() => { activeTab = "series"; isEditingEpisodes = false; }}
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap {activeTab === 'series' ? 'bg-[#e8590c] text-white shadow-lg shadow-[#e8590c]/25' : 'text-gray-400 hover:text-white hover:bg-[#171e2e]'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          จัดการซีรีส์และตอน ({seriesList.length})
        </button>

        <button
          type="button"
          onclick={() => { activeTab = "settings"; isEditingEpisodes = false; }}
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap {activeTab === 'settings' ? 'bg-[#e8590c] text-white shadow-lg shadow-[#e8590c]/25' : 'text-gray-400 hover:text-white hover:bg-[#171e2e]'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          สำรองข้อมูล & ตั้งค่า PIN
        </button>
      </nav>

      <!-- TAB 1: DASHBOARD -->
      {#if activeTab === 'dashboard'}
        <div class="flex flex-col gap-6">
          <!-- Stat cards -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="p-6 rounded-2xl bg-[#0f131a] border border-[#1e2638] flex items-center justify-between">
              <div>
                <p class="text-xs uppercase font-semibold tracking-wider text-gray-400">ภาพยนตร์ทั้งหมด</p>
                <p class="text-3xl font-black text-white mt-1">{movies.length}</p>
              </div>
              <div class="w-12 h-12 rounded-xl bg-[#e8590c]/15 text-[#f97316] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
              </div>
            </div>

            <div class="p-6 rounded-2xl bg-[#0f131a] border border-[#1e2638] flex items-center justify-between">
              <div>
                <p class="text-xs uppercase font-semibold tracking-wider text-gray-400">ซีรีส์ทั้งหมด</p>
                <p class="text-3xl font-black text-white mt-1">{seriesList.length}</p>
              </div>
              <div class="w-12 h-12 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
            </div>

            <div class="p-6 rounded-2xl bg-[#0f131a] border border-[#1e2638] flex items-center justify-between">
              <div>
                <p class="text-xs uppercase font-semibold tracking-wider text-gray-400">ตอนซีรีส์สะสม</p>
                <p class="text-3xl font-black text-white mt-1">{totalEpisodesCount}</p>
              </div>
              <div class="w-12 h-12 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              </div>
            </div>
          </div>

          <!-- Quick Action Banner -->
          <div class="p-6 rounded-2xl bg-gradient-to-r from-[#171a25] to-[#121620] border border-[#232c40] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-bold text-white">ต้องการเพิ่มภาพยนตร์หรือซีรีส์ใหม่?</h2>
              <p class="text-xs text-gray-400 mt-1">คุณสามารถวางโค้ด JSON/W3U หรือกดปุ่มเพิ่มทีละเรื่องได้ทันที</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onclick={() => { activeTab = "import"; }}
                class="px-4 py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white font-bold text-xs shadow-md shadow-[#e8590c]/20 transition-all cursor-pointer">
                + วางโค้ดแบบกลุ่ม
              </button>
              <button
                type="button"
                onclick={openAddMovie}
                class="px-4 py-2.5 rounded-xl bg-[#1e2638] hover:bg-[#28334a] text-white font-semibold text-xs border border-[#2e3b56] transition-all cursor-pointer">
                + เพิ่มหนังเดี่ยว
              </button>
            </div>
          </div>
        </div>

      <!-- TAB 2: SMART IMPORTER -->
      {:else if activeTab === 'import'}
        <div class="flex flex-col gap-6 bg-[#0f131a] border border-[#1e2638] rounded-3xl p-6 md:p-8">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[#f97316]"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              ระบบวางโค้ดนำเข้าอัจฉริยะ (Smart Code Importer)
            </h2>
            <p class="text-xs text-gray-400 mt-1">รองรับการวางโค้ด JavaScript Object / JSON ทั้งหนังเดี่ยวและซีรีส์หลายตอน ระบบจะตรวจจับและจัดหมวดหมู่อัตโนมัติ</p>
          </div>

          <!-- Code Textarea -->
          <div class="flex flex-col gap-2">
            <textarea
              bind:value={rawImportCode}
              oninput={handleImportInput}
              rows="10"
              placeholder="วางโค้ดหนังหรือซีรีส์ที่นี่... (รองรับทั้ง JSON และ JavaScript Object)"
              class="w-full font-mono text-xs p-4 rounded-xl bg-[#090b10] border border-[#1e273a] text-gray-200 focus:outline-none focus:border-[#e8590c] custom-scroll leading-relaxed">
            </textarea>
          </div>

          <!-- Live Detection Preview -->
          {#if importParseResult.movies.length > 0 || importParseResult.series.length > 0}
            <div class="p-4 rounded-2xl bg-[#131824] border border-emerald-500/30 flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-emerald-400 flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  ตรวจพบ: {importParseResult.movies.length} ภาพยนตร์, {importParseResult.series.length} ซีรีส์
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scroll">
                {#each importParseResult.movies as m}
                  <div class="text-xs bg-[#0c0f17] p-2 rounded-lg border border-[#1d2538] flex items-center gap-2 truncate">
                    <span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">หนัง</span>
                    <span class="truncate text-gray-200">{m.name}</span>
                  </div>
                {/each}
                {#each importParseResult.series as s}
                  <div class="text-xs bg-[#0c0f17] p-2 rounded-lg border border-[#1d2538] flex items-center gap-2 truncate">
                    <span class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">ซีรีส์</span>
                    <span class="truncate text-gray-200">{s.name} ({s.stations?.length || 0} ตอน)</span>
                  </div>
                {/each}
              </div>
            </div>
          {:else if importParseResult.error}
            <div class="text-xs text-red-400 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              {importParseResult.error}
            </div>
          {/if}

          <!-- Status Message -->
          {#if importStatus.text}
            <div class="text-xs p-3 rounded-xl {importStatus.type === 'error' ? 'bg-red-500/15 text-red-300 border border-red-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}">
              {importStatus.text}
            </div>
          {/if}

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <button
              type="button"
              onclick={executeAdminImport}
              disabled={isImporting || (!importParseResult.movies.length && !importParseResult.series.length)}
              class="px-6 py-3 rounded-xl bg-gradient-to-r from-[#e8590c] to-[#f97316] font-bold text-white text-xs shadow-lg shadow-[#e8590c]/25 hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer">
              {isImporting ? "กำลังนำเข้า..." : "บันทึกเข้าสู่คลังทันที"}
            </button>
            <button
              type="button"
              onclick={() => { rawImportCode = ""; importParseResult = { movies: [], series: [], error: null }; importStatus = { text: "", type: "" }; }}
              class="px-4 py-3 rounded-xl bg-[#171e2e] hover:bg-[#20293d] text-gray-300 font-semibold text-xs border border-[#232d42] transition-colors cursor-pointer">
              ล้างข้อความ
            </button>
          </div>
        </div>

      <!-- TAB 3: MOVIES MANAGER -->
      {:else if activeTab === 'movies'}
        <div class="flex flex-col gap-4">
          <!-- Toolbar -->
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div class="relative flex-1 max-w-md">
              <input
                type="text"
                bind:value={movieSearch}
                placeholder="ค้นหาภาพยนตร์ตามชื่อหรือหมวดหมู่..."
                class="w-full pl-10 pr-4 py-2 bg-[#0f131a] border border-[#1e2638] rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e8590c]"
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="absolute left-3 top-2.5 text-gray-500"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>

            <button
              type="button"
              onclick={openAddMovie}
              class="px-4 py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white text-xs font-bold shadow-md shadow-[#e8590c]/20 transition-all cursor-pointer flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              เพิ่มภาพยนตร์เรื่องใหม่
            </button>
          </div>

          <!-- Movies Table / Cards -->
          {#if filteredMovies.length === 0}
            <div class="p-12 text-center rounded-2xl bg-[#0f131a] border border-[#1e2638] text-gray-400 text-sm">
              ไม่พบภาพยนตร์ในคลัง (กดปุ่ม "+ เพิ่มภาพยนตร์เรื่องใหม่" หรือนำเข้าโค้ดเพื่อเริ่มต้น)
            </div>
          {:else}
            <div class="bg-[#0f131a] border border-[#1e2638] rounded-2xl overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr class="border-b border-[#1e2638] bg-[#141924] text-gray-400 font-semibold uppercase tracking-wider">
                      <th class="py-3 px-4 w-16">ปก</th>
                      <th class="py-3 px-4">ชื่อภาพยนตร์</th>
                      <th class="py-3 px-4">หมวดหมู่</th>
                      <th class="py-3 px-4">ปี</th>
                      <th class="py-3 px-4 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[#171d2b]">
                    {#each filteredMovies as m}
                      <tr class="hover:bg-[#121722] transition-colors">
                        <td class="py-2 px-4">
                          <img
                            src={m.logo || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=100"}
                            alt={m.name}
                            class="w-10 h-14 object-cover rounded-md bg-[#1a202c]"
                            onerror={(e) => { e.target.src = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=100" }}
                          />
                        </td>
                        <td class="py-2 px-4 font-semibold text-white">
                          <div class="truncate max-w-xs md:max-w-md">{m.name}</div>
                          <div class="text-[10px] text-gray-500 font-mono truncate max-w-xs">{m.url}</div>
                        </td>
                        <td class="py-2 px-4 text-gray-300">{m.category || "ภาพยนตร์"}</td>
                        <td class="py-2 px-4 text-gray-400">{m.year || "-"}</td>
                        <td class="py-2 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onclick={() => openEditMovie(m)}
                            class="px-2.5 py-1 rounded bg-[#1e2638] hover:bg-[#28334a] text-gray-200 text-xs font-medium mr-1 transition-colors cursor-pointer">
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onclick={() => handleDeleteMovie(m.id, m.name)}
                            class="px-2.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium transition-colors cursor-pointer">
                            ลบ
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        </div>

      <!-- TAB 4: SERIES & EPISODES MANAGER -->
      {:else if activeTab === 'series'}
        {#if isEditingEpisodes && selectedSeries}
          <!-- Episode Manager View -->
          <div class="flex flex-col gap-4">
            <div class="flex items-center justify-between bg-[#0f131a] border border-[#1e2638] p-4 rounded-2xl">
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  onclick={() => { isEditingEpisodes = false; }}
                  class="p-2 rounded-xl bg-[#171d2b] hover:bg-[#20283a] text-gray-300 transition-colors cursor-pointer">
                  ← ย้อนกลับ
                </button>
                <div>
                  <h2 class="text-base font-bold text-white flex items-center gap-2">
                    {selectedSeries.name}
                    <span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {selectedSeriesInfo?.episodes?.["1"]?.length || 0} ตอน
                    </span>
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onclick={openAddEpisode}
                class="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white text-xs font-bold shadow-md shadow-[#e8590c]/20 transition-all cursor-pointer flex items-center gap-2">
                + เพิ่มตอนใหม่
              </button>
            </div>

            <!-- Episodes Table -->
            {#if !selectedSeriesInfo?.episodes?.["1"]?.length}
              <div class="p-12 text-center rounded-2xl bg-[#0f131a] border border-[#1e2638] text-gray-400 text-sm">
                ยังไม่มีตอนในซีรีส์นี้ (คลิก "+ เพิ่มตอนใหม่" เพื่อเริ่มใส่ลิงก์สตรีม EP.1)
              </div>
            {:else}
              <div class="bg-[#0f131a] border border-[#1e2638] rounded-2xl overflow-hidden">
                <table class="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr class="border-b border-[#1e2638] bg-[#141924] text-gray-400 font-semibold uppercase tracking-wider">
                      <th class="py-3 px-4 w-20">ลำดับตอน</th>
                      <th class="py-3 px-4">ชื่อตอน</th>
                      <th class="py-3 px-4">ลิงก์วิดีโอสตรีม</th>
                      <th class="py-3 px-4 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[#171d2b]">
                    {#each selectedSeriesInfo.episodes["1"] as ep}
                      <tr class="hover:bg-[#121722] transition-colors">
                        <td class="py-3 px-4 font-mono font-bold text-[#f97316]">EP.{ep.episode_num}</td>
                        <td class="py-3 px-4 font-medium text-white">{ep.title || `EP.${ep.episode_num}`}</td>
                        <td class="py-3 px-4 text-gray-400 font-mono truncate max-w-xs md:max-w-md">{ep.url}</td>
                        <td class="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onclick={() => openEditEpisode(ep)}
                            class="px-2.5 py-1 rounded bg-[#1e2638] hover:bg-[#28334a] text-gray-200 text-xs font-medium mr-1 transition-colors cursor-pointer">
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onclick={() => handleDeleteEpisode(ep.id, ep.title || `EP.${ep.episode_num}`)}
                            class="px-2.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium transition-colors cursor-pointer">
                            ลบ
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {:else}
          <!-- Series List -->
          <div class="flex flex-col gap-4">
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div class="relative flex-1 max-w-md">
                <input
                  type="text"
                  bind:value={seriesSearch}
                  placeholder="ค้นหาซีรีส์ตามชื่อ..."
                  class="w-full pl-10 pr-4 py-2 bg-[#0f131a] border border-[#1e2638] rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#e8590c]"
                />
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="absolute left-3 top-2.5 text-gray-500"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </div>

              <button
                type="button"
                onclick={openAddSeries}
                class="px-4 py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white text-xs font-bold shadow-md shadow-[#e8590c]/20 transition-all cursor-pointer flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                เพิ่มซีรีส์เรื่องใหม่
              </button>
            </div>

            {#if filteredSeries.length === 0}
              <div class="p-12 text-center rounded-2xl bg-[#0f131a] border border-[#1e2638] text-gray-400 text-sm">
                ไม่พบซีรีส์ในคลัง
              </div>
            {:else}
              <div class="bg-[#0f131a] border border-[#1e2638] rounded-2xl overflow-hidden">
                <table class="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr class="border-b border-[#1e2638] bg-[#141924] text-gray-400 font-semibold uppercase tracking-wider">
                      <th class="py-3 px-4 w-16">ปก</th>
                      <th class="py-3 px-4">ชื่อซีรีส์</th>
                      <th class="py-3 px-4">หมวดหมู่</th>
                      <th class="py-3 px-4">ปี</th>
                      <th class="py-3 px-4 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[#171d2b]">
                    {#each filteredSeries as s}
                      <tr class="hover:bg-[#121722] transition-colors">
                        <td class="py-2 px-4">
                          <img
                            src={s.logo || "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=100"}
                            alt={s.name}
                            class="w-10 h-14 object-cover rounded-md bg-[#1a202c]"
                            onerror={(e) => { e.target.src = "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=100" }}
                          />
                        </td>
                        <td class="py-2 px-4 font-semibold text-white">
                          <div>{s.name}</div>
                        </td>
                        <td class="py-2 px-4 text-gray-300">{s.category || "ซีรีส์"}</td>
                        <td class="py-2 px-4 text-gray-400">{s.year || "-"}</td>
                        <td class="py-2 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onclick={() => openEpisodeManager(s)}
                            class="px-3 py-1 rounded bg-[#e8590c]/20 hover:bg-[#e8590c]/30 text-[#f97316] text-xs font-bold mr-1 border border-[#e8590c]/30 transition-colors cursor-pointer">
                            จัดการตอน ➔
                          </button>
                          <button
                            type="button"
                            onclick={() => openEditSeries(s)}
                            class="px-2.5 py-1 rounded bg-[#1e2638] hover:bg-[#28334a] text-gray-200 text-xs font-medium mr-1 transition-colors cursor-pointer">
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onclick={() => handleDeleteSeries(s.id, s.name)}
                            class="px-2.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium transition-colors cursor-pointer">
                            ลบ
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {/if}

      <!-- TAB 5: BACKUP & SETTINGS -->
      {:else if activeTab === 'settings'}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Change PIN Card -->
          <div class="p-6 rounded-2xl bg-[#0f131a] border border-[#1e2638] flex flex-col gap-4">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[#f97316]"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                เปลี่ยนรหัส PIN ล็อคหลังบ้าน
              </h2>
              <p class="text-xs text-gray-400 mt-1">รหัส PIN ป้องกันไม่ให้ผู้อื่นเข้ามาแก้ไขหนังและซีรีส์</p>
            </div>

            <div class="flex flex-col gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1">รหัส PIN ปัจจุบัน</label>
                <input
                  type="password"
                  bind:value={currentPin}
                  placeholder="รหัสปัจจุบัน (เริ่มต้น: 1234)"
                  class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-xs text-white focus:outline-none focus:border-[#e8590c]"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1">รหัส PIN ใหม่ (4-8 หลัก)</label>
                <input
                  type="password"
                  bind:value={newPin}
                  placeholder="รหัส PIN ใหม่"
                  class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-xs text-white focus:outline-none focus:border-[#e8590c]"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1">ยืนยันรหัส PIN ใหม่</label>
                <input
                  type="password"
                  bind:value={confirmPin}
                  placeholder="พิมพ์รหัส PIN ใหม่อีกครั้ง"
                  class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-xs text-white focus:outline-none focus:border-[#e8590c]"
                />
              </div>

              {#if pinChangeStatus.text}
                <div class="text-xs p-2.5 rounded-lg {pinChangeStatus.type === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}">
                  {pinChangeStatus.text}
                </div>
              {/if}

              <button
                type="button"
                onclick={handleChangePin}
                class="w-full mt-2 py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white font-bold text-xs shadow-md shadow-[#e8590c]/20 transition-all cursor-pointer">
                บันทึกรหัส PIN ใหม่
              </button>
            </div>
          </div>

          <!-- Backup & Restore Card -->
          <div class="p-6 rounded-2xl bg-[#0f131a] border border-[#1e2638] flex flex-col gap-4">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                สำรองและกู้คืนคลังข้อมูล (Backup & Restore)
              </h2>
              <p class="text-xs text-gray-400 mt-1">สำรองรายการหนัง ซีรีส์ และตอนทั้งหมดเพื่อความปลอดภัย หรือย้ายไปติดตั้งในเครื่องอื่น</p>
            </div>

            <div class="flex flex-col gap-4 mt-2">
              <div class="p-4 rounded-xl bg-[#141924] border border-[#1f283c] flex flex-col gap-2">
                <span class="text-xs font-semibold text-white">1. สำรองข้อมูลออกเป็นไฟล์ (Export JSON)</span>
                <p class="text-[11px] text-gray-400">ดาวน์โหลดรายการทั้งหมดออกมาเป็นไฟล์ .json เก็บไว้ในคอมพิวเตอร์ของคุณ</p>
                <button
                  type="button"
                  onclick={handleExport}
                  class="mt-1 py-2 px-4 rounded-lg bg-[#1f283c] hover:bg-[#2a3650] text-gray-200 font-semibold text-xs transition-colors cursor-pointer w-fit">
                  ดาวน์โหลดไฟล์สำรองข้อมูล (.json)
                </button>
              </div>

              <div class="p-4 rounded-xl bg-[#141924] border border-[#1f283c] flex flex-col gap-2">
                <span class="text-xs font-semibold text-white">2. นำเข้าจากไฟล์สำรอง (Restore JSON)</span>
                <p class="text-[11px] text-gray-400">เลือกไฟล์ .json ที่เคยสำรองไว้เพื่อนำข้อมูลกลับเข้าสู่ระบบ</p>
                <label class="mt-1 py-2 px-4 rounded-lg bg-[#1f283c] hover:bg-[#2a3650] text-gray-200 font-semibold text-xs transition-colors cursor-pointer w-fit">
                  เลือกไฟล์สำรองข้อมูลเพื่อกู้คืน
                  <input type="file" accept=".json" onchange={handleImportFile} class="hidden" />
                </label>
              </div>
            </div>
          </div>
        </div>
      {/if}

    </div>
  </div>

  <!-- MODAL: ADD / EDIT MOVIE -->
  {#if showMovieModal}
    <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-[#0f131a] border border-[#1e2638] rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        <h3 class="text-base font-bold text-white">
          {movieForm.id ? "แก้ไขข้อมูลภาพยนตร์" : "เพิ่มภาพยนตร์เรื่องใหม่"}
        </h3>

        <div class="flex flex-col gap-3 text-xs">
          <div>
            <label class="block font-medium text-gray-400 mb-1">ชื่อภาพยนตร์ *</label>
            <input
              type="text"
              bind:value={movieForm.name}
              placeholder="เช่น The Rundown (2003) โคตรคนล่าขุมทรัพย์"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
            />
          </div>

          <div>
            <label class="block font-medium text-gray-400 mb-1">ลิงก์วิดีโอสตรีม (.m3u8 หรือ .mp4) *</label>
            <input
              type="text"
              bind:value={movieForm.url}
              placeholder="https://.../video.m3u8"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
            />
          </div>

          <div>
            <label class="block font-medium text-gray-400 mb-1">ลิงก์รูปโปสเตอร์ (Image URL)</label>
            <input
              type="text"
              bind:value={movieForm.logo}
              placeholder="https://.../poster.jpg"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-medium text-gray-400 mb-1">หมวดหมู่</label>
              <input
                type="text"
                bind:value={movieForm.category}
                placeholder="ภาพยนตร์, แอคชั่น, ดราม่า"
                class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
              />
            </div>
            <div>
              <label class="block font-medium text-gray-400 mb-1">ปีที่ฉาย</label>
              <input
                type="text"
                bind:value={movieForm.year}
                placeholder="2026"
                class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
              />
            </div>
          </div>

          <div>
            <label class="block font-medium text-gray-400 mb-1">HTTP Referer (ถ้ามี)</label>
            <input
              type="text"
              bind:value={movieForm.referer}
              placeholder="เช่น https://www.website.com/"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onclick={() => { showMovieModal = false; }}
            class="px-4 py-2 rounded-xl bg-[#171d2b] hover:bg-[#20283a] text-gray-300 font-semibold text-xs cursor-pointer">
            ยกเลิก
          </button>
          <button
            type="button"
            onclick={handleSaveMovie}
            class="px-5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white font-bold text-xs shadow-md shadow-[#e8590c]/20 cursor-pointer">
            บันทึก
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- MODAL: ADD / EDIT SERIES -->
  {#if showSeriesModal}
    <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-[#0f131a] border border-[#1e2638] rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        <h3 class="text-base font-bold text-white">
          {seriesForm.id ? "แก้ไขข้อมูลซีรีส์" : "เพิ่มซีรีส์เรื่องใหม่"}
        </h3>

        <div class="flex flex-col gap-3 text-xs">
          <div>
            <label class="block font-medium text-gray-400 mb-1">ชื่อซีรีส์ *</label>
            <input
              type="text"
              bind:value={seriesForm.name}
              placeholder="เช่น Bloodhounds Season 2 (2026)"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
            />
          </div>

          <div>
            <label class="block font-medium text-gray-400 mb-1">ลิงก์รูปโปสเตอร์ซีรีส์ (Image URL)</label>
            <input
              type="text"
              bind:value={seriesForm.logo}
              placeholder="https://.../poster.jpg"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-medium text-gray-400 mb-1">หมวดหมู่</label>
              <input
                type="text"
                bind:value={seriesForm.category}
                placeholder="ซีรีส์เกาหลี, แอคชั่น"
                class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
              />
            </div>
            <div>
              <label class="block font-medium text-gray-400 mb-1">ปีที่ฉาย</label>
              <input
                type="text"
                bind:value={seriesForm.year}
                placeholder="2026"
                class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
              />
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onclick={() => { showSeriesModal = false; }}
            class="px-4 py-2 rounded-xl bg-[#171d2b] hover:bg-[#20283a] text-gray-300 font-semibold text-xs cursor-pointer">
            ยกเลิก
          </button>
          <button
            type="button"
            onclick={handleSaveSeries}
            class="px-5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white font-bold text-xs shadow-md shadow-[#e8590c]/20 cursor-pointer">
            บันทึก
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- MODAL: ADD / EDIT EPISODE -->
  {#if showEpisodeModal}
    <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-[#0f131a] border border-[#1e2638] rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        <h3 class="text-base font-bold text-white">
          {episodeForm.id ? "แก้ไขตอนซีรีส์" : "เพิ่มตอนใหม่ให้ " + (selectedSeries?.name || "")}
        </h3>

        <div class="flex flex-col gap-3 text-xs">
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block font-medium text-gray-400 mb-1">ลำดับตอน *</label>
              <input
                type="number"
                bind:value={episodeForm.episode_num}
                min="1"
                class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
              />
            </div>
            <div class="col-span-2">
              <label class="block font-medium text-gray-400 mb-1">ชื่อตอน</label>
              <input
                type="text"
                bind:value={episodeForm.title}
                placeholder="เช่น EP.1 หรือ ชื่อตอน"
                class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white focus:outline-none focus:border-[#e8590c]"
              />
            </div>
          </div>

          <div>
            <label class="block font-medium text-gray-400 mb-1">ลิงก์วิดีโอสตรีม (.m3u8 หรือ .mp4) *</label>
            <input
              type="text"
              bind:value={episodeForm.url}
              placeholder="https://.../audio.m3u8"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
            />
          </div>

          <div>
            <label class="block font-medium text-gray-400 mb-1">HTTP Referer (ถ้ามี)</label>
            <input
              type="text"
              bind:value={episodeForm.referer}
              placeholder="เช่น https://www.doo-nang.com/"
              class="w-full px-3 py-2 bg-[#141924] border border-[#1f283c] rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onclick={() => { showEpisodeModal = false; }}
            class="px-4 py-2 rounded-xl bg-[#171d2b] hover:bg-[#20283a] text-gray-300 font-semibold text-xs cursor-pointer">
            ยกเลิก
          </button>
          <button
            type="button"
            onclick={handleSaveEpisode}
            class="px-5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#f97316] text-white font-bold text-xs shadow-md shadow-[#e8590c]/20 cursor-pointer">
            บันทึกตอน
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  .animate-shake {
    animation: shake 0.3s ease-in-out;
  }
</style>
