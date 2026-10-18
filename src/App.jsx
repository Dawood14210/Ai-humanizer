import React, { useState } from 'react'
import { humanize } from './engine/index.js'


export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  const handleHumanize = () => {
    const result = humanize(input, { seed: 1234 })
    setOutput(result.output)
  }

  return (
    <div className="min-h-full bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">Plainwrite</h1>
          <p className="mt-1 text-sm text-stone-600">
            A rule-based text humanizer that runs entirely in your browser. No LLM. No external API.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <label className="mb-2 block text-sm font-medium text-stone-700">
              Paste your text
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type or paste the text you want to humanize..."
              className="h-64 w-full resize-y rounded-md border border-stone-300 bg-white p-3 text-sm shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
            />
            <button
              onClick={handleHumanize}
              className="mt-3 inline-flex items-center rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-stone-700"
            >
              Humanize
            </button>
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium text-stone-700">
              Humanized output
            </label>
            <div className="h-64 w-full overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-white p-3 text-sm shadow-sm">
              {output || <span className="text-stone-400">Output will appear here.</span>}
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4 text-xs text-stone-500">
          100% local — your text never leaves this page.
        </div>
      </footer>
    </div>
  )
}
