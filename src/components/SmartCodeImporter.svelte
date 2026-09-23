<script>
  import { onMount } from "svelte"
  import { getActiveEntry } from "@/scripts/lib/creds.js"
  import { getCached, setCached, hydrate as hydrateCache } from "@/scripts/lib/cache.js"
  import { normalize } from "@/scripts/lib/text.js"

  let isOpen = $state(false)
  let rawCode = $state("")
  let parseResult = $state({ movies: [], series: [], error: null })
  let isImporting = $state(false)
  let statusMessage = $state({ text: "", type: "" })

  const SAMPLE_MOVIE = `[
  {
    name: "The Rundown (2003) โคตรคนล่าขุมทรัพย์ป่านรก",
    image: "https://www.037hdmovie.com/wp-content/uploads/2020/01/The-Rundown-2003-%E0%B9%82%E0%B8%84%E0%B8%95%E0%B8%A3%E0%B8%84%E0%B8%99-%E0%B8%A5%E0%B9%88%E0%B8%B2%E0%B8%82%E0%B8%B8%E0%B8%A1%E0%B8%97%E0%B8%A3%E0%B8%B1%E0%B8%9E%E0%B8%A2%E0%B9%8C%E0%B8%9B%E0%B9%88%E0%B8%B2%E0%B8%99%E0%B8%A3%E0%B8%81.png",
    url: "https://statics-01.quackquackcdn.com/037a24e2-1d21-57a4-b264-0ec5b76693de/audio-tha/audio.m3u8",
    referer: "https://www.ดูบอลดูหนัง.com/",
    playInNatPlayer: "true"
  },
  {
    name: "Con Air (1997) ปฏิบัติการแหกนรกยึดฟ้า",
    image: "https://www.037hdmovie.com/wp-content/uploads/2018/04/JSYdSHANc1jCG4ZEDMl.jpg",
    url: "https://statics-01.quackquackcdn.com/0333498a-297e-5421-94fb-4628d441b099/audio-default/audio.m3u8",
    referer: "https://www.ดูบอลดูหนัง.com/",
    playInNatPlayer: "true"
  },
  {
    name: "Black Widow (2021) แบล็ค วิโดว์",
    image: "https://f.ptcdn.info/087/075/000/r0o92u13duUZ4S862XVT-o.jpg",
    url: "https://statics-01.quackquackcdn.com/c2a42930-4e00-53cc-b9de-a68c62478534/audio-tha/audio.m3u8",
    referer: "https://www.ดูบอลดูหนัง.com/",
    playInNatPlayer: "true"
  }
]`

  const SAMPLE_SERIES = `[
  { 
    name: "Bloodhounds Season 2 (2026)", 
    image: "https://cms.dmpcdn.com/ugcarticle/2026/04/04/5558a330-2fe3-11f1-b7f0-833cf24abc1f_webp_original.webp",
    stations: [
      { name: "EP.1 ", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/9ab23c2b-9fd8-575e-897f-2fd5c79348e6/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" },
      { name: "EP.2 ", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/07b184f2-f0fe-5cde-b15e-14b1e7ca2aba/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" },
      { name: "EP.3 ", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/9d4853f8-f534-5871-b8a1-174207467bc3/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" },
      { name: "EP.4 ", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/586c9659-1de2-5eeb-866b-1dc43dfb5bbd/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" },
      { name: "EP.5 ", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/e80a551f-8bd9-5fa4-aa37-6c9de854f15f/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" },
      { name: "EP.6 ", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/6e77642a-47cc-5710-a752-fd9e4089fa1e/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" },
      { name: "EP.7 END", image: "https://m.media-amazon.com/images/M/MV5BYjhjZmYwYjItYjA1Yy00NzkwLTk1OWMtZjYzZTg2MWFiYmFjXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg", url: "https://statics-02.quackquackcdn.com/cae006ed-0b02-55ae-bce9-9dadd6710fcb/audio-tha/audio.m3u8", referer: "https://www.doo-nang.com/" }
    ]
  }
]`

  function parseInput(text) {
    if (!text || !text.trim()) {
      return { movies: [], series: [], error: null }
    }

    let cleaned = text.trim()
    if (!cleaned.startsWith("[")) cleaned = "[" + cleaned
    if (!cleaned.endsWith("]")) cleaned = cleaned.replace(/,\s*$/, "") + "]"

    let items = []
    try {
      const fn = new Function("return " + cleaned)
      const res = fn()
      items = Array.isArray(res) ? res : [res]
    } catch (e) {
      return { movies: [], series: [], error: "รูปแบบโค้ดไม่ถูกต้อง กรุณาตรวจสอบวงเล็บปีกกา { } หรือเครื่องหมายจุลภาค ," }
    }

    const movies = []
    const series = []

    for (const item of items) {
      if (!item || typeof item !== "object") continue

      if (Array.isArray(item.stations) && item.stations.length > 0) {
        series.push({
          name: String(item.name || "ซีรีส์ไม่ระบุชื่อ").trim(),
          image: item.image || item.cover || "",
          stations: item.stations.filter((s) => s && (s.url || s.link)),
          referer: item.referer || ""
        })
      } else if (item.url || item.link) {
        movies.push({
          name: String(item.name || item.title || "ภาพยนตร์ไม่ระบุชื่อ").trim(),
          image: item.image || item.logo || item.cover || "",
          url: item.url || item.link,
          referer: item.referer || "",
          category: item.category || item.info || "ภาพยนตร์"
        })
      }
    }

    return { movies, series, error: null }
  }

  function handleInputChange(e) {
    rawCode = e.target.value
    parseResult = parseInput(rawCode)
  }

  function loadSample(type) {
    if (type === "movie") rawCode = SAMPLE_MOVIE
    else if (type === "series") rawCode = SAMPLE_SERIES
    else rawCode = SAMPLE_MOVIE.slice(0, -1) + ",\n" + SAMPLE_SERIES.slice(1)
    parseResult = parseInput(rawCode)
  }

  async function executeImport() {
    if (parseResult.movies.length === 0 && parseResult.series.length === 0) {
      statusMessage = { text: "กรุณาวางโค้ดหนังหรือซีรีส์ที่ถูกต้องก่อนกดบันทึก", type: "error" }
      return
    }

    isImporting = true
    statusMessage = { text: "กำลังประมวลผลและบันทึกเข้าสู่คลัง...", type: "info" }

    try {
      const active = await getActiveEntry()
      if (!active || !active._id) {
        statusMessage = { text: "ไม่พบเพลย์ลิสต์ที่กำลังใช้งานอยู่ กรุณาเลือกเพลย์ลิสต์ก่อน", type: "error" }
        isImporting = false
        return
      }

      const playlistId = active._id
      const VOD_TTL = 30 * 24 * 60 * 60 * 1000

      // 1. Process Movies
      if (parseResult.movies.length > 0) {
        await hydrateCache(playlistId, "m3u")
        const currentM3u = getCached(playlistId, "m3u")
        let movieList = Array.isArray(currentM3u?.data) ? [...currentM3u.data] : []

        for (let i = 0; i < parseResult.movies.length; i++) {
          const m = parseResult.movies[i]
          const id = Date.now() + i
          const year = (m.name.match(/\((\d{4})\)/) || [])[1] || ""

          // Insert at the front (Top of catalogue)
          movieList.unshift({
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
            norm: normalize(m.name + " " + (m.category || "") + " " + year),
            url: m.url,
            directUrl: m.url,
            referer: m.referer || ""
          })
        }

        setCached(playlistId, "m3u", movieList, VOD_TTL)
        document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "vod" } }))
      }

      // 2. Process Series
      if (parseResult.series.length > 0) {
        await hydrateCache(playlistId, "series")
        const currentSeries = getCached(playlistId, "series")
        let seriesList = Array.isArray(currentSeries?.data) ? [...currentSeries.data] : []

        for (let i = 0; i < parseResult.series.length; i++) {
          const s = parseResult.series[i]
          const seriesId = Date.now() + 10000 + i
          const year = (s.name.match(/\((\d{4})\)/) || [])[1] || ""

          // Ep list
          const eps = s.stations.map((st, epIdx) => ({
            id: seriesId * 1000 + epIdx + 1,
            episode_num: epIdx + 1,
            title: st.name ? st.name.trim() : `ตอนที่ ${epIdx + 1}`,
            container_extension: "m3u8",
            _directUrl: st.url,
            url: st.url,
            referer: st.referer || s.referer || "",
            info: st.info || ""
          }))

          // Series Info
          const seriesInfoData = {
            info: {
              name: s.name,
              cover: s.image,
              plot: s.name,
              rating: "8.8",
              releaseDate: year || "2026",
              category_name: "ซีรีส์"
            },
            seasons: [
              {
                season_number: 1,
                name: "Season 1",
                episode_count: eps.length
              }
            ],
            episodes: {
              "1": eps
            }
          }

          setCached(playlistId, `series_info_${seriesId}`, seriesInfoData, VOD_TTL)

          // Insert into series catalogue at the front
          seriesList.unshift({
            id: seriesId,
            series_id: seriesId,
            name: s.name,
            logo: s.image || null,
            year,
            rating: "8.8",
            category: "ซีรีส์",
            plot: s.name,
            added: Date.now(),
            norm: normalize(s.name + " ซีรีส์ " + year),
            isW3uSeries: true
          })
        }

        setCached(playlistId, "series", seriesList, VOD_TTL)
        document.dispatchEvent(new CustomEvent("xt:cache-revalidated", { detail: { entryId: playlistId, kind: "series" } }))
      }

      // Refresh current views
      document.dispatchEvent(new CustomEvent("xt:active-changed"))

      statusMessage = {
        text: `🎉 นำเข้าสำเร็จเรียบร้อย! (เพิ่ม ${parseResult.movies.length} ภาพยนตร์, ${parseResult.series.length} ซีรีส์)`,
        type: "success"
      }

      setTimeout(() => {
        isImporting = false
        rawCode = ""
        parseResult = { movies: [], series: [], error: null }
        isOpen = false
      }, 1800)

    } catch (err) {
      console.error("Import error:", err)
      statusMessage = { text: "เกิดข้อผิดพลาดในการบันทึก: " + err.message, type: "error" }
      isImporting = false
    }
  }

  onMount(() => {
    const handleOpen = () => { isOpen = true; statusMessage = { text: "", type: "" } }
    window.addEventListener("open-smart-importer", handleOpen)

    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault()
        isOpen = !isOpen
        statusMessage = { text: "", type: "" }
      }
      if (e.key === "Escape" && isOpen) {
        isOpen = false
      }
    }
    window.addEventListener("keydown", handleKey)

    // Listen to click on any element with data-open-smart-importer
    const handleDocClick = (e) => {
      const btn = e.target.closest("[data-open-smart-importer]")
      if (btn) {
        e.preventDefault()
        handleOpen()
      }
    }
    document.addEventListener("click", handleDocClick)

    return () => {
      window.removeEventListener("open-smart-importer", handleOpen)
      window.removeEventListener("keydown", handleKey)
      document.removeEventListener("click", handleDocClick)
    }
  })
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div 
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
    onclick={(e) => { if (e.target === e.currentTarget) isOpen = false }}
    role="dialog"
    aria-modal="true"
  >
    <!-- Modal Container -->
    <div class="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-[#0c1017] shadow-2xl shadow-black/90 overflow-hidden text-fg">
      
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#121824]/90">
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              วางโค้ดนำเข้าหนัง & ซีรีส์ (Smart Importer)
              <span class="text-xs px-2 py-0.5 rounded-full bg-accent/20 border border-accent/40 text-accent font-normal">W3U / JSON</span>
            </h2>
            <p class="text-xs text-fg-3">ก๊อปปี้โค้ดหนังเดี่ยว หรือ ซีรีส์ที่มี stations มาวางลงที่นี่ได้เลย ระบบจะแยกหมวดให้อัตโนมัติ</p>
          </div>
        </div>
        <button 
          onclick={() => isOpen = false}
          class="size-8 rounded-lg flex items-center justify-center text-fg-3 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <!-- Quick Samples Strip -->
      <div class="flex items-center gap-2 px-6 py-2.5 bg-[#0e131d] border-b border-white/5 text-xs">
        <span class="text-fg-3">ตัวอย่างพร้อมลอง:</span>
        <button 
          type="button" 
          onclick={() => loadSample("movie")} 
          class="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/90 transition-colors"
        >
          🎬 ตัวอย่างหนัง (3 เรื่อง)
        </button>
        <button 
          type="button" 
          onclick={() => loadSample("series")} 
          class="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/90 transition-colors"
        >
          📺 ตัวอย่างซีรีส์ (7 ตอน)
        </button>
        <button 
          type="button" 
          onclick={() => loadSample("both")} 
          class="px-2.5 py-1 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent transition-colors ml-auto"
        >
          ⚡ ใส่ทั้งหนังและซีรีส์
        </button>
      </div>

      <!-- Textarea Input Area -->
      <div class="p-6 flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
        <label for="code-input" class="text-xs font-semibold uppercase tracking-wider text-fg-2 flex items-center justify-between">
          <span>วางก้อนโค้ดที่นี่:</span>
          <span class="text-2xs text-fg-3 font-normal">รองรับทั้ง single object, comma-separated หรือ array [ ... ]</span>
        </label>
        
        <textarea
          id="code-input"
          value={rawCode}
          oninput={handleInputChange}
          placeholder={"{\n  name: \"The Rundown (2003) โคตรคนล่าขุมทรัพย์ป่านรก\",\n  image: \"https://...\",\n  url: \"https://...audio.m3u8\",\n  referer: \"https://...\"\n}"}
          rows="9"
          class="w-full font-mono text-xs p-3.5 rounded-xl border border-white/10 bg-[#07090e] text-white/90 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none placeholder:text-fg-3/40"
        ></textarea>

        <!-- Detection Results / Errors -->
        {#if parseResult.error}
          <div class="p-3 rounded-xl border border-bad/30 bg-bad/10 text-bad text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>{parseResult.error}</span>
          </div>
        {:else if parseResult.movies.length > 0 || parseResult.series.length > 0}
          <div class="p-3.5 rounded-xl border border-white/10 bg-[#141a26] flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold text-white">🔎 ตรวจพบข้อมูลในโค้ด:</span>
              <div class="flex items-center gap-3">
                <span class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                  🎬 หนัง {parseResult.movies.length} เรื่อง
                </span>
                <span class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  📺 ซีรีส์ {parseResult.series.length} เรื่อง ({parseResult.series.reduce((acc, s) => acc + s.stations.length, 0)} ตอน)
                </span>
              </div>
            </div>

            <!-- Preview Items Strip -->
            <div class="flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin">
              {#each parseResult.movies as m}
                <div class="shrink-0 flex items-center gap-2 p-1.5 pr-3 rounded-lg bg-black/40 border border-white/5 text-2xs">
                  {#if m.image}
                    <img src={m.image} alt={m.name} class="size-6 object-cover rounded" />
                  {/if}
                  <span class="font-medium text-white truncate max-w-[120px]">{m.name}</span>
                  <span class="text-fg-3 text-[10px] bg-white/5 px-1 py-0.5 rounded">หนัง</span>
                </div>
              {/each}
              {#each parseResult.series as s}
                <div class="shrink-0 flex items-center gap-2 p-1.5 pr-3 rounded-lg bg-black/40 border border-amber-500/30 text-2xs">
                  {#if s.image}
                    <img src={s.image} alt={s.name} class="size-6 object-cover rounded" />
                  {/if}
                  <span class="font-medium text-amber-300 truncate max-w-[120px]">{s.name}</span>
                  <span class="text-amber-400 text-[10px] bg-amber-500/10 px-1 py-0.5 rounded">{s.stations.length} ตอน</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if statusMessage.text}
          <div class={`p-3 rounded-xl text-xs flex items-center gap-2 ${
            statusMessage.type === "success" ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300" :
            statusMessage.type === "error" ? "border border-bad/40 bg-bad/15 text-bad" :
            "border border-accent/40 bg-accent/15 text-accent"
          }`}>
            <span>{statusMessage.text}</span>
          </div>
        {/if}
      </div>

      <!-- Footer Buttons -->
      <div class="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-[#0e131d]">
        <span class="text-2xs text-fg-3">กด <kbd class="px-1.5 py-0.5 rounded bg-white/10 text-white">Ctrl + I</kbd> เพื่อเปิด/ปิดหน้าต่างนี้</span>
        
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={() => isOpen = false}
            class="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium text-fg-2 transition-colors"
          >
            ยกเลิก
          </button>
          
          <button
            type="button"
            onclick={executeImport}
            disabled={isImporting || (parseResult.movies.length === 0 && parseResult.series.length === 0)}
            class="px-5 py-2 rounded-xl bg-gradient-to-r from-accent to-[#b80c25] hover:opacity-95 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {isImporting ? "กำลังนำเข้า..." : "🚀 บันทึกเข้าคลังทันที"}
          </button>
        </div>
      </div>

    </div>
  </div>
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-fade-in {
    animation: fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
</style>
