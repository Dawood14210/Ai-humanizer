import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STAGES = [
  { key: 'normalize', label: 'Normalize', note: 'Spacing and line endings' },
  { key: 'cleanup', label: 'Clean up', note: 'Punctuation and formatting' },
  { key: 'phrases', label: 'Plain-language phrases', note: 'Curated phrase rules' },
  { key: 'transitions', label: 'Transitions', note: 'Reduce repetitive openers' },
  { key: 'contractions', label: 'Contractions', note: 'Natural contractions' },
  { key: 'rhythm', label: 'Sentence rhythm', note: 'Careful sentence variation' },
  { key: 'synonyms', label: 'Synonyms', note: 'May change meaning' },
]

const DEFAULT_STAGES = Object.fromEntries(STAGES.map(stage => [stage.key, stage.key !== 'synonyms']))
const prettyStage = key => STAGES.find(stage => stage.key === key)?.label || key

function getInitialTheme() {
  try {
    return localStorage.getItem('plainwrite-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function splitProtectedWords(value) {
  return value.split(/[\n,]+/).map(word => word.trim()).filter(Boolean)
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1)
    globalThis.crypto.getRandomValues(value)
    return String(value[0])
  }
  return String(Math.floor(Math.random() * 0xffffffff))
}

const metricRows = [
  { key: 'words', label: 'Word count', format: value => String(value) },
  { key: 'sentences', label: 'Sentence count', format: value => String(value) },
  { key: 'avgSentenceLength', label: 'Average sentence length', format: value => `${value} words` },
  { key: 'sentenceLengthStdDev', label: 'Sentence length variation', format: value => `${value} words` },
  { key: 'flaggedMarkerCount', label: 'Flagged markers', format: value => String(value) },
  { key: 'flagOnly', label: 'Flag-only ordinary words', group: 'flaggedMarkers', format: value => String(value) },
  { key: 'tierA', label: 'Tier A markers', group: 'flaggedMarkers', format: value => String(value) },
  { key: 'tierB', label: 'Tier B markers', group: 'flaggedMarkers', format: value => String(value) },
  { key: 'tierC', label: 'Tier C markers', group: 'flaggedMarkers', format: value => String(value) },
  { key: 'repeatedConnectors', label: 'Repeated connectors', format: value => String(value) },
]

function metricValue(metrics, row) {
  return row.group ? metrics?.[row.group]?.[row.key] ?? 0 : metrics?.[row.key] ?? 0
}

function MetricPanel({ title, metrics, comparison, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {comparison && <span className="text-[10px] font-medium uppercase tracking-wider text-slate-600">After − before</span>}
      </div>
      <dl className="space-y-2.5">
        {metricRows.map(row => {
          const current = metricValue(metrics, row)
          const previous = comparison ? metricValue(comparison, row) : null
          const delta = comparison ? current - previous : null
          return (
            <div key={row.key} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-2 border-b border-slate-200/70 pb-2 last:border-0 last:pb-0 dark:border-slate-700/70">
              <dt className="min-w-0 text-xs text-slate-600 dark:text-slate-400">{row.label}</dt>
              <dd className={`text-right text-xs font-semibold tabular-nums ${tone === 'after' ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-100'}`}>{metrics ? row.format(current) : '—'}</dd>
              {comparison && <dd className={`min-w-[2.4rem] text-right text-[10px] font-semibold tabular-nums ${delta > 0 ? 'text-amber-700 dark:text-amber-300' : delta < 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600'}`} aria-label={`Change ${delta > 0 ? 'plus ' : ''}${delta}`}>{delta > 0 ? '+' : ''}{delta}</dd>}
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function StyleMetrics({ metrics }) {
  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-[#111927] sm:p-5" aria-labelledby="style-metrics-heading">
      <div className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">A closer look at the draft</p>
        <h2 id="style-metrics-heading" className="mt-1 text-base font-semibold dark:text-slate-100">Style metrics</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">A side-by-side count of style patterns before and after editing.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <MetricPanel title="Before" metrics={metrics?.before} tone="before" />
        <MetricPanel title="After" metrics={metrics?.after} comparison={metrics?.before} tone="after" />
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-600 dark:text-slate-400">These metrics describe style patterns only. They do not predict the result of any AI detector.</p>
    </section>
  )
}

function ChangeDetails({ change, onRevert, busy }) {
  if (!change) return null
  return (
    <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm dark:border-indigo-400/20 dark:bg-indigo-400/10" aria-live="polite" aria-label="Selected change details">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-indigo-950 dark:text-indigo-100">Change details</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-[5.5rem_1fr]">
            <dt className="text-slate-600 dark:text-slate-400">Rule</dt>
            <dd className="break-words font-medium text-slate-800 dark:text-slate-100">{change.ruleName || change.rule?.id || 'Plainwrite rule'}</dd>
            <dt className="text-slate-600 dark:text-slate-400">Stage</dt>
            <dd className="text-slate-800 dark:text-slate-100">{prettyStage(change.stage)}</dd>
            <dt className="text-slate-600 dark:text-slate-400">Tier</dt>
            <dd className="text-slate-800 dark:text-slate-100">{change.tier || 'Built-in'}</dd>
            <dt className="text-slate-600 dark:text-slate-400">Source</dt>
            <dd className="break-words text-slate-800 dark:text-slate-100">{change.source || 'Plainwrite built-in rules'}</dd>
            <dt className="text-slate-600 dark:text-slate-400">Changed</dt>
            <dd className="break-words text-slate-800 dark:text-slate-100">{change.original || '∅'} <span aria-hidden="true">→</span> {change.replacement || '∅'}</dd>
          </dl>
        </div>
        <button
          type="button"
          onClick={() => onRevert(change)}
          disabled={busy}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-sm font-semibold text-indigo-800 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 dark:border-indigo-300/20 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-300/10 dark:focus-visible:ring-offset-slate-900"
        >
          Revert this change
        </button>
      </div>
    </section>
  )
}

function DiffText({ output, changes, selectedKey, onSelect }) {
  const visible = [...(changes || [])]
    .filter(change => !change.superseded && Number.isInteger(change.finalStart) && Number.isInteger(change.finalEnd))
    .sort((a, b) => a.finalStart - b.finalStart || a.finalEnd - b.finalEnd)
  if (visible.length === 0) return <>{output}</>

  const nodes = []
  let cursor = 0
  visible.forEach((change, index) => {
    const start = Math.max(cursor, change.finalStart)
    const end = Math.max(start, change.finalEnd)
    if (start > cursor) nodes.push(output.slice(cursor, start))
    const key = `${change.stage}:${change.rule?.id}:${change.inputStart}:${change.inputEnd}`
    const isSelected = key === selectedKey
    if (end > start) {
      nodes.push(
        <button
          key={`${key}-${index}`}
          type="button"
          onClick={() => onSelect(change, key)}
          aria-label={`Changed from ${change.original || 'nothing'} to ${change.replacement || 'nothing'}. Show rule details.`}
          aria-pressed={isSelected}
          className={`inline rounded px-0.5 text-left underline decoration-2 underline-offset-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isSelected ? 'bg-indigo-200 text-indigo-950 decoration-indigo-700 ring-1 ring-inset ring-indigo-300 dark:bg-indigo-300/25 dark:text-indigo-100 dark:decoration-indigo-200' : 'bg-amber-200 text-amber-950 decoration-amber-700 ring-1 ring-inset ring-amber-300 hover:bg-amber-300 dark:bg-amber-300/25 dark:text-amber-50 dark:decoration-amber-200 dark:ring-amber-300/30 dark:hover:bg-amber-300/35'}`}
        >
          {output.slice(start, end)}
        </button>,
      )
      cursor = end
    } else {
      nodes.push(
        <button
          key={`${key}-${index}`}
          type="button"
          onClick={() => onSelect(change, key)}
          aria-label={`Removed ${change.original}. Show rule details.`}
          aria-pressed={isSelected}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-100 px-1 align-middle text-[10px] font-bold text-rose-700 underline decoration-rose-400 dark:bg-rose-300/15 dark:text-rose-200"
        >−</button>,
      )
    }
  })
  if (cursor < output.length) nodes.push(output.slice(cursor))
  return <>{nodes}</>
}

export default function App() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [language, setLanguage] = useState(null)
  const [progress, setProgress] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [runtimeMs, setRuntimeMs] = useState(null)
  const [intensity, setIntensity] = useState('medium')
  const [stages, setStages] = useState(DEFAULT_STAGES)
  const [seed, setSeed] = useState('314159')
  const [protectedWords, setProtectedWords] = useState('')
  const [theme, setTheme] = useState(getInitialTheme)
  const [workerReady, setWorkerReady] = useState(false)
  const [dictionaryCounts, setDictionaryCounts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState(null)
  const [reverted, setReverted] = useState([])
  const workerRef = useRef(null)
  const requestRef = useRef(0)
  const latestRequestRef = useRef(0)
  const workerFactoryRef = useRef(null)
  const startedAtRef = useRef(0)
  const elapsedTimerRef = useRef(null)

  useEffect(() => {
    const attachWorker = () => {
      const worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = event => {
        const message = event.data || {}
        if (message.type === 'ready') {
          setDictionaryCounts(message.dictionaries)
          setWorkerReady(true)
          return
        }
        if (message.id !== latestRequestRef.current) return
        if (message.type === 'progress') {
          setProgress(message.progress)
          return
        }
        setBusy(false)
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
        if (message.type === 'error') {
          setError(message.error || 'The engine could not process this text.')
          return
        }
        if (message.type === 'result') {
          setResult(message.result)
          setMetrics(message.metrics)
          setLanguage(message.language)
          setRuntimeMs(message.runtimeMs)
          setElapsedMs(message.runtimeMs || performance.now() - startedAtRef.current)
          setProgress({ stage: 'complete', completed: 7, total: 7, percent: 100 })
          setSelected(null)
          setError('')
          setNotice('Your draft is ready. It was processed on this device.')
        }
      }
      worker.onerror = event => {
        setBusy(false)
        setWorkerReady(false)
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
        setError(event.message || 'The local writing worker could not start.')
      }
      return worker
    }
    workerFactoryRef.current = attachWorker
    attachWorker()
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!busy) return undefined
    elapsedTimerRef.current = setInterval(() => {
      setElapsedMs(Math.max(0, performance.now() - startedAtRef.current))
    }, 100)
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [busy])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('plainwrite-theme', theme)
    } catch {
      // Theme still works for this visit if storage is unavailable.
    }
  }, [theme])

  const optionsForRun = useCallback((excludedChanges = [], seedOverride = seed) => ({
    seed: Number.isFinite(Number(seedOverride)) ? Number(seedOverride) : 0,
    intensity,
    stages,
    synonyms: stages.synonyms === true,
    protectedWords: splitProtectedWords(protectedWords),
    excludedChanges,
  }), [intensity, protectedWords, seed, stages])

  const runEngine = useCallback((excludedChanges = [], seedOverride = seed) => {
    if (!workerRef.current || !workerReady || !input.trim()) return
    const id = ++requestRef.current
    latestRequestRef.current = id
    startedAtRef.current = performance.now()
    setElapsedMs(0)
    setRuntimeMs(null)
    setProgress({ stage: 'starting', completed: 0, total: 7, percent: 0 })
    setLanguage(null)
    setBusy(true)
    setError('')
    setNotice('')
    setSelected(null)
    workerRef.current.postMessage({
      id,
      text: input,
      options: optionsForRun(excludedChanges, seedOverride),
    })
  }, [input, optionsForRun, seed, workerReady])

  const cancelRun = (message = 'Run cancelled.') => {
    latestRequestRef.current = ++requestRef.current
    workerRef.current?.terminate()
    workerRef.current = null
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    setBusy(false)
    setWorkerReady(false)
    setProgress(null)
    setNotice(message)
    setRuntimeMs(null)
    workerFactoryRef.current?.()
  }

  const handleHumanize = () => {
    setReverted([])
    runEngine([], seed)
  }

  const handleReshuffle = () => {
    const nextSeed = randomSeed()
    setSeed(nextSeed)
    setReverted([])
    runEngine([], nextSeed)
  }

  const handleRevert = change => {
    const exclusion = {
      stage: change.stage,
      id: change.rule?.id,
      inputStart: change.inputStart,
      inputEnd: change.inputEnd,
      start: change.start,
      end: change.end,
    }
    const next = [...reverted.filter(item => !(item.stage === exclusion.stage && item.id === exclusion.id && item.inputStart === exclusion.inputStart && item.inputEnd === exclusion.inputEnd)), exclusion]
    setReverted(next)
    runEngine(next, seed)
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.output)
      setNotice('Output copied to your clipboard.')
    } catch {
      setError('Clipboard access was blocked. Select and copy the output instead.')
    }
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([result.output], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'plainwrite-output.txt'
    anchor.click()
    URL.revokeObjectURL(href)
  }

  const handleClear = () => {
    if (busy) cancelRun('Workspace cleared.')
    else latestRequestRef.current = ++requestRef.current
    setBusy(false)
    setInput('')
    setProtectedWords('')
    setResult(null)
    setMetrics(null)
    setLanguage(null)
    setProgress(null)
    setRuntimeMs(null)
    setSelected(null)
    setReverted([])
    setError('')
    setNotice('Workspace cleared.')
  }

  const toggleStage = key => setStages(current => ({ ...current, [key]: !current[key] }))
  const selectedChange = useMemo(() => selected?.change || null, [selected])
  const canRun = workerReady && !busy && Boolean(input.trim())
  const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0

  return (
    <div className="min-h-screen bg-[#f6f7f8] text-slate-900 transition-colors dark:bg-[#0c111b] dark:text-slate-100">
      <header className="border-b border-slate-200/80 bg-white/90 dark:border-slate-800 dark:bg-[#111927]/90">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
          <a href="#top" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="Plainwrite home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm shadow-indigo-600/20">p.</span>
            <span>
              <span className="block text-[17px] font-bold tracking-tight">plainwrite</span>
              <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">A calmer first draft</span>
            </span>
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:inline-flex ${workerReady ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`} title={dictionaryCounts ? `Loaded JSON dictionaries: ${Object.entries(dictionaryCounts).map(([name, count]) => `${name} ${count}`).join(', ')}` : 'Loading bundled dictionaries in the worker'}>
              <span className={`h-1.5 w-1.5 rounded-full ${workerReady ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
              {workerReady ? 'Private worker ready' : 'Starting local worker'}
            </span>
            <button
              type="button"
              onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={theme === 'dark'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-amber-200 dark:hover:bg-slate-700"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {theme === 'dark' ? <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M4.1 4.1l1.4 1.4m13 13 1.4 1.4M2.5 12h2m15 0h2M4.1 19.9l1.4-1.4m13-13 1.4-1.4" /></> : <path d="M20.4 15.7A8.5 8.5 0 0 1 8.3 3.6 8.5 8.5 0 1 0 20.4 15.7Z" />}
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-[1440px] px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-10">
        <section className="mb-7 flex flex-col justify-between gap-5 md:mb-8 md:flex-row md:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Your words stay yours
            </p>
            <h1 className="text-[2rem] font-semibold leading-[1.12] tracking-[-0.045em] sm:text-4xl lg:text-[42px]">Make your writing feel<br className="hidden sm:block" /> clear, not complicated.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400 sm:text-base">A thoughtful, rule-based edit for a more natural read. Everything runs locally in your browser—no AI calls, no uploads.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-indigo-300 dark:ring-slate-700" aria-hidden="true">⌁</span>
            <span>Browser-only processing<br /><strong className="font-semibold text-slate-700 dark:text-slate-200">Your text never leaves this device</strong></span>
          </div>
        </section>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-[#111927] dark:shadow-black/10" aria-labelledby="input-heading">
            <div className="flex min-h-[65px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">01</span>
                <div>
                  <h2 id="input-heading" className="text-sm font-semibold dark:text-slate-100">Your draft</h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">Paste or write your text</p>
                </div>
              </div>
              <span className="whitespace-nowrap text-xs tabular-nums text-slate-600 dark:text-slate-400">{wordCount} words · {input.length} chars</span>
            </div>
            <label htmlFor="draft-input" className="sr-only">Draft text to humanize</label>
            {!input.trim() && <p role="status" className="px-4 pt-3 text-xs leading-5 text-slate-600 dark:text-slate-400 sm:px-5">{input.length ? 'This draft contains only whitespace. Add words to enable Humanize.' : 'Paste some text here. Empty drafts are ignored.'}</p>}
            <textarea
              id="draft-input"
              value={input}
              onChange={event => { if (busy) cancelRun('Run cancelled because the draft changed.'); else latestRequestRef.current = ++requestRef.current; setInput(event.target.value); setResult(null); setMetrics(null); setLanguage(null); setRuntimeMs(null); setSelected(null); setNotice('') }}
              placeholder={'Paste your draft here…\n\nYour original meaning matters. Plainwrite makes small, rule-based edits to help the words flow.'}
              spellCheck="true"
              className="block min-h-[300px] w-full resize-y border-0 bg-transparent px-4 py-4 text-[15px] leading-7 text-slate-800 placeholder:text-slate-600 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-600 sm:min-h-[345px] sm:px-5"
            />
            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40 sm:px-5">
              <label htmlFor="protected-words" className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span aria-hidden="true" className="text-slate-600">◇</span> Keep these words unchanged
              </label>
              <textarea
                id="protected-words"
                value={protectedWords}
                onChange={event => setProtectedWords(event.target.value)}
                rows={2}
                placeholder="Names, product terms… separate with commas or new lines"
                className="block min-h-[58px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-800 placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/10"
              />
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-[#111927] dark:shadow-black/10" aria-labelledby="output-heading">
            <div className="flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">02</span>
                <div>
                  <h2 id="output-heading" className="text-sm font-semibold dark:text-slate-100">Your polished draft</h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">Select a highlight to inspect it</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={handleCopy} disabled={!result} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">Copy output</button>
                <button type="button" onClick={handleDownload} disabled={!result} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">Download .txt</button>
                <button type="button" onClick={handleClear} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 dark:text-slate-400 dark:hover:bg-rose-400/10 dark:hover:text-rose-200">Clear all</button>
              </div>
            </div>
            <div className="min-h-[300px] px-4 py-4 sm:min-h-[345px] sm:px-5">
              {result ? (
                <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-800 dark:text-slate-100" aria-label="Humanized text with interactive change highlights">
                  <DiffText output={result.output} changes={result.changes} selectedKey={selected?.key} onSelect={(change, key) => setSelected({ change, key })} />
                </div>
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-5 text-center sm:min-h-[305px]">
                  <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-xl text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300" aria-hidden="true">✳</span>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Your revised text will appear here</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-slate-600 dark:text-slate-400">Changes are highlighted so you can inspect every rule and undo individual edits.</p>
                </div>
              )}
            </div>
            {result && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400 sm:px-5"><span>{result.changes.filter(change => !change.superseded).length} visible edits <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span> {result.stats.words} words</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-amber-400 bg-amber-200 dark:border-amber-300/50 dark:bg-amber-300/30" /> Highlighted changes</span></div>}
          </section>
        </div>

        <StyleMetrics metrics={metrics} />
        <ChangeDetails change={selectedChange} onRevert={handleRevert} busy={busy} />

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-[#111927] sm:p-5" aria-labelledby="settings-heading">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="settings-heading" className="text-sm font-semibold dark:text-slate-100">Fine-tune your edit</h2>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Choose how much to change and which rules to use.</p>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Intensity
                  <select value={intensity} onChange={event => setIntensity(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-500/10">
                    <option value="light">Light</option><option value="medium">Medium</option><option value="strong">Strong</option>
                  </select>
                </label>
              </div>
              <fieldset>
                <legend className="sr-only">Transformation stages</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {STAGES.map(stage => (
                    <label key={stage.key} className={`flex min-h-[52px] cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition focus-within:ring-2 focus-within:ring-indigo-400 ${stages[stage.key] ? 'border-indigo-100 bg-indigo-50/50 dark:border-indigo-500/20 dark:bg-indigo-500/5' : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-800/60'}`}>
                      <input type="checkbox" checked={Boolean(stages[stage.key])} onChange={() => toggleStage(stage.key)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800" />
                      <span className="min-w-0"><span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">{stage.label}</span><span className="mt-0.5 block text-[10px] leading-4 text-slate-600 dark:text-slate-400">{stage.note}</span></span>
                    </label>
                  ))}
                </div>
                {stages.synonyms && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-300/10 dark:text-amber-200"><strong>Meaning-change warning:</strong> synonyms can alter nuance. Review every highlighted substitution.</p>}
              </fieldset>
            </div>
            <div className="flex w-full flex-col gap-3 xl:w-[265px] xl:shrink-0">
              <label htmlFor="seed" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Random seed <span className="font-normal text-slate-600 dark:text-slate-400">· same seed, same result</span></label>
              <div className="flex gap-2">
                <input id="seed" type="number" inputMode="numeric" value={seed} onChange={event => setSeed(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-500/10" />
                <button type="button" onClick={handleReshuffle} disabled={!workerReady || !input.trim() || busy} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Reshuffle</button>
              </div>
              <button type="button" onClick={handleHumanize} disabled={!canRun} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300 disabled:shadow-none dark:focus-visible:ring-offset-[#111927]">
                {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Working locally…</> : <>Humanize <span aria-hidden="true">→</span></>}
              </button>
              {busy && <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 dark:border-indigo-400/20 dark:bg-indigo-400/5">
                <div role="progressbar" aria-label="Humanizing text" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent || 0} aria-valuetext={`${prettyStage(progress?.stage)} stage, ${Math.floor(elapsedMs / 100) / 10} seconds elapsed`} className="h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 dark:bg-indigo-400" style={{ width: `${Math.max(4, progress?.percent || 0)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-indigo-900 dark:text-indigo-200">{prettyStage(progress?.stage)} · {(elapsedMs / 1000).toFixed(1)}s</span>
                  <button type="button" onClick={() => cancelRun()} className="rounded-md px-2 py-1 font-semibold text-rose-700 underline decoration-rose-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-300">Cancel</button>
                </div>
              </div>}
              {!busy && runtimeMs !== null && <p className="text-center text-[11px] text-slate-600 dark:text-slate-400">Completed in {(runtimeMs / 1000).toFixed(2)}s in the local worker.</p>}
            </div>
          </div>
        </section>

        <div className="mt-4 flex min-h-6 flex-wrap items-center justify-between gap-2 px-1 text-xs" aria-live="polite">
          <span className={error ? 'text-rose-600 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}>{error || notice || (workerReady ? 'Ready when you are.' : 'Loading local dictionaries into the web worker…')}</span>
          {dictionaryCounts && <span className="text-slate-600 dark:text-slate-400">JSON loaded in worker · {dictionaryCounts.phrases} phrase rules · {dictionaryCounts.synonyms} synonyms</span>}
        </div>
        {language && !language.isEnglish && result && <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">This text may be non-English ({language.code}). English-only stages were skipped; cleanup remained available.</p>}
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-[#111927] sm:p-5" aria-labelledby="about-heading">
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-700 dark:text-indigo-300">About</p>
            <h2 id="about-heading" className="mt-1 text-base font-semibold dark:text-slate-100">Plainwrite, plainly</h2>
          </div>
          <div className="grid gap-4 text-sm leading-6 text-slate-700 dark:text-slate-300 md:grid-cols-2">
            <div>
              <p>Plainwrite edits writing style with fixed rules and uses no AI model. It is not a detector bypass and makes no claim about any detector.</p>
              <p className="mt-3">The phrase list draws on published studies through 2025. It ages as people notice changing markers and is reviewed over time.</p>
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">Phrase dictionary v{dictionaryCounts?.phraseVersion || '…'} · last reviewed {dictionaryCounts?.lastReviewed || '…'}</p>
            </div>
            <div>
              <p>You are responsible for following your school’s or employer’s rules on AI use.</p>
              <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-medium leading-5 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">Privacy: all text stays in your browser; nothing is sent anywhere.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white/70 py-5 dark:border-slate-800 dark:bg-[#111927]/70">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-1 px-4 text-xs text-slate-600 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10"><span>Plainwrite · A clear edit, never a black box.</span><span>Local rules only. No network requests for your text.</span></div>
      </footer>
    </div>
  )
}
