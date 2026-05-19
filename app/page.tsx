'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import Image from 'next/image'
import { unzip } from 'fflate'
import { ImportedContact } from '@/lib/types'

interface TargetCompany {
  name: string
  domain: string
  logo: string | null
}

// ── ZIP extraction ─────────────────────────────────────────────────────────
async function extractConnectionsCSV(zipFile: File): Promise<string> {
  const buffer = await zipFile.arrayBuffer()
  const uint8 = new Uint8Array(buffer)

  return new Promise((resolve, reject) => {
    unzip(uint8, (err, files) => {
      if (err) {
        reject(new Error('Could not read the ZIP file. Try downloading it again from LinkedIn.'))
        return
      }
      // LinkedIn sometimes nests files in a subfolder — match by filename only
      const key = Object.keys(files).find(
        (k) => k.split('/').pop()?.toLowerCase() === 'connections.csv'
      )
      if (!key) {
        reject(
          new Error(
            'Connections.csv not found in this ZIP. Make sure you selected "Connections" when requesting your LinkedIn data.'
          )
        )
        return
      }
      resolve(new TextDecoder('utf-8').decode(files[key]))
    })
  })
}

// ── Matching ───────────────────────────────────────────────────────────────
function matchesTarget(contact: ImportedContact, target: TargetCompany): boolean {
  const nameMatch = contact.company
    ? contact.company.toLowerCase().includes(target.name.toLowerCase())
    : false
  const domainMatch =
    contact.email && target.domain
      ? contact.email.toLowerCase().endsWith('@' + target.domain.toLowerCase())
      : false
  return nameMatch || domainMatch
}

function findMatchingTarget(
  contact: ImportedContact,
  targets: TargetCompany[]
): TargetCompany | null {
  return targets.find((t) => matchesTarget(contact, t)) ?? null
}

type ViewMode = 'all' | 'matches'

// ── Small components ───────────────────────────────────────────────────────
function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold mr-2 shrink-0 ${
        done ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'
      }`}
    >
      {done ? '✓' : n}
    </span>
  )
}

function CompanyLogo({ logo, name }: { logo: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (!logo || failed) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-[10px] font-bold text-slate-400 shrink-0">
        {name[0]?.toUpperCase() ?? '?'}
      </span>
    )
  }
  return (
    <Image
      src={logo}
      alt={name}
      width={24}
      height={24}
      className="w-6 h-6 rounded object-contain bg-white shrink-0"
      onError={() => setFailed(true)}
      unoptimized
    />
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Home() {
  // Step 1 — target companies
  const [targetCompanies, setTargetCompanies] = useState<TargetCompany[]>([])
  const [companyInput, setCompanyInput] = useState('')
  const [suggestions, setSuggestions] = useState<TargetCompany[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Step 2 — LinkedIn import
  const [contacts, setContacts] = useState<ImportedContact[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadStep, setUploadStep] = useState<'idle' | 'extracting' | 'parsing'>('idle')

  // Step 3 — view
  const [viewMode, setViewMode] = useState<ViewMode>('matches')

  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clearbit autocomplete
  useEffect(() => {
    const q = companyInput.trim()
    if (!q) {
      setSuggestions([])
      setSuggestionsLoading(false)
      return
    }
    clearTimeout(debounceRef.current)
    setSuggestionsLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`
        )
        const data: TargetCompany[] = await res.json()
        setSuggestions(
          data.filter((s) => !targetCompanies.some((t) => t.domain === s.domain))
        )
      } catch {
        setSuggestions([])
      } finally {
        setSuggestionsLoading(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [companyInput, targetCompanies])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)

    try {
      let csvText: string

      if (file.name.toLowerCase().endsWith('.zip')) {
        setUploadStep('extracting')
        csvText = await extractConnectionsCSV(file)
      } else {
        setUploadStep('parsing')
        csvText = await file.text()
      }

      setUploadStep('parsing')
      const res = await fetch('/api/contacts/linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: csvText,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to parse file')
      setContacts(data.contacts)
      setSource('LinkedIn')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setUploading(false)
      setUploadStep('idle')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function addCompany(company: TargetCompany) {
    if (!targetCompanies.some((t) => t.domain === company.domain)) {
      setTargetCompanies((prev) => [...prev, company])
    }
    setCompanyInput('')
    setSuggestions([])
    setShowSuggestions(false)
    setActiveSuggestion(-1)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function removeCompany(domain: string) {
    setTargetCompanies((prev) => prev.filter((c) => c.domain !== domain))
  }

  function handleCompanyKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestion((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        addCompany(suggestions[activeSuggestion])
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setActiveSuggestion(-1)
    }
  }

  function handleExport(matchedOnly: boolean) {
    const data = matchedOnly
      ? contacts.filter((c) => findMatchingTarget(c, targetCompanies))
      : contacts
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contacts-${matchedOnly ? 'matches' : 'all'}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const matchedContacts = contacts.filter((c) => findMatchingTarget(c, targetCompanies))
  const displayedContacts =
    viewMode === 'matches' && targetCompanies.length > 0 ? matchedContacts : contacts

  const step1Done = targetCompanies.length > 0
  const step2Done = contacts.length > 0
  const step3Active = step1Done && step2Done

  const uploadLabel = uploading
    ? uploadStep === 'extracting'
      ? 'Extracting Connections.csv…'
      : 'Parsing contacts…'
    : 'Upload LinkedIn export'

  return (
    <main className="min-h-screen bg-slate-100 font-sans">
      <header className="bg-slate-900 h-14 flex items-center px-6">
        <span className="text-white font-bold text-[13px] tracking-wide">
          Contact Import <span className="text-orange-500">Pilot</span>
        </span>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-[22px] font-bold text-slate-900 mb-1">Import Contacts</h1>
        <p className="text-[13px] text-slate-500 mb-8">
          Choose your target companies, import your LinkedIn contacts, and see who you know there.
        </p>

        {/* ── Step 1 — Target companies ── */}
        <div
          className={`bg-white rounded-lg border p-5 mb-4 ${
            step1Done ? 'border-orange-300' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center mb-1">
            <StepBadge n={1} done={step1Done} />
            <span className="text-[13px] font-bold text-slate-900">
              Choose your target companies
            </span>
          </div>
          <p className="text-[13px] text-slate-500 mb-3 ml-8">
            Search any company by name — powered by Clearbit&apos;s company database. Add as many
            as you like.
          </p>

          <div className="ml-8">
            <div className="relative flex gap-2 mb-3">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={companyInput}
                  onChange={(e) => {
                    setCompanyInput(e.target.value)
                    setShowSuggestions(true)
                    setActiveSuggestion(-1)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={handleCompanyKeyDown}
                  placeholder="Search companies — e.g. McKinsey, Google, JPMorgan…"
                  className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-slate-400"
                />
                {showSuggestions && companyInput.trim() && (
                  <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-64 overflow-y-auto">
                    {suggestionsLoading && suggestions.length === 0 && (
                      <li className="px-3 py-3 text-[13px] text-slate-400 flex items-center gap-2">
                        <span className="animate-spin inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full" />
                        Searching…
                      </li>
                    )}
                    {!suggestionsLoading && suggestions.length === 0 && (
                      <li className="px-3 py-3 text-[13px] text-slate-400">
                        No companies found. Try a different name.
                      </li>
                    )}
                    {suggestions.map((s, i) => (
                      <li
                        key={s.domain}
                        onMouseDown={() => addCompany(s)}
                        className={`px-3 py-2.5 text-[13px] cursor-pointer flex items-center gap-3 ${
                          i === activeSuggestion
                            ? 'bg-orange-50 text-orange-700'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <CompanyLogo logo={s.logo} name={s.name} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{s.name}</div>
                          <div className="text-[11px] text-slate-400">{s.domain}</div>
                        </div>
                        {contacts.length > 0 && (
                          <span className="text-[11px] text-slate-400 shrink-0">
                            {contacts.filter((c) => matchesTarget(c, s)).length} contacts
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {targetCompanies.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {targetCompanies.map((company) => {
                  const count = contacts.filter((c) => matchesTarget(c, company)).length
                  return (
                    <span
                      key={company.domain}
                      className="inline-flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-800 text-[12px] font-medium pl-2 pr-3 py-1 rounded-full"
                    >
                      <CompanyLogo logo={company.logo} name={company.name} />
                      <span>{company.name}</span>
                      {contacts.length > 0 && count > 0 && (
                        <span className="text-orange-400 text-[11px]">({count})</span>
                      )}
                      <button
                        onClick={() => removeCompany(company.domain)}
                        className="text-orange-300 hover:text-orange-700 font-bold leading-none ml-0.5"
                        aria-label={`Remove ${company.name}`}
                      >
                        &times;
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Step 2 — LinkedIn import ── */}
        <div
          className={`bg-white rounded-lg border p-5 mb-4 transition-opacity ${
            step1Done ? 'opacity-100' : 'opacity-40 pointer-events-none'
          } ${step2Done ? 'border-orange-300' : 'border-slate-200'}`}
        >
          <div className="flex items-center mb-1">
            <StepBadge n={2} done={step2Done} />
            <span className="text-[13px] font-bold text-slate-900">
              Import your LinkedIn connections
            </span>
          </div>

          {step2Done ? (
            /* ── Already uploaded ── */
            <div className="ml-8 mt-3 flex items-center justify-between">
              <span className="text-[13px] text-slate-500">
                <span className="font-semibold text-slate-900">{contacts.length} contacts</span>{' '}
                loaded from {source}
              </span>
              <label className="cursor-pointer text-[12px] text-slate-400 hover:text-slate-700 underline underline-offset-2">
                Re-upload
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip,.csv"
                  className="sr-only"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          ) : (
            /* ── Instructions + upload ── */
            <div className="ml-8 mt-3">

              {/* Step-by-step guide */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  How to get your LinkedIn connections file
                </p>
                <ol className="space-y-3">
                  {[
                    {
                      n: 1,
                      text: 'Open LinkedIn's data export page',
                      action: (
                        <a
                          href="https://www.linkedin.com/mypreferences/d/download-my-data"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-orange-600 hover:text-orange-700 underline underline-offset-2"
                        >
                          Open LinkedIn →
                        </a>
                      ),
                    },
                    {
                      n: 2,
                      text: 'Select “Connections” only, then click “Request archive”',
                    },
                    {
                      n: 3,
                      text: 'Check your email — LinkedIn will send a download link (usually 10–30 minutes)',
                    },
                    {
                      n: 4,
                      text: 'Click the link in the email to download your ZIP file, then upload it below',
                    },
                  ].map(({ n, text, action }) => (
                    <li key={n} className="flex items-start gap-3">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 shrink-0 mt-0.5">
                        {n}
                      </span>
                      <span className="text-[13px] text-slate-600 flex-1">
                        {text}
                        {action && <span className="ml-2">{action}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Privacy note */}
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4">
                <span className="text-blue-400 text-[15px] shrink-0 mt-0.5">🔒</span>
                <p className="text-[12px] text-blue-700 leading-relaxed">
                  <span className="font-semibold">Your data stays private.</span> The ZIP file is
                  processed entirely in your browser — only your connections list is read. No other
                  LinkedIn data is accessed, and nothing is stored on our servers.
                </p>
              </div>

              {/* Upload error */}
              {uploadError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded mb-4">
                  {uploadError}
                </div>
              )}

              {/* Upload button */}
              <label className="inline-flex items-center gap-2 cursor-pointer bg-slate-900 text-white text-[12px] font-semibold px-4 py-2.5 rounded hover:bg-slate-700 transition-colors">
                {uploading ? (
                  <>
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                    {uploadLabel}
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0-8L5 5m3-3l3 3M2 11v1.5A1.5 1.5 0 003.5 14h9A1.5 1.5 0 0014 12.5V11" />
                    </svg>
                    Upload LinkedIn export
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip,.csv"
                  className="sr-only"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
              <p className="text-[11px] text-slate-400 mt-2">
                Accepts the LinkedIn export <span className="font-mono">.zip</span> or{' '}
                <span className="font-mono">Connections.csv</span> directly
              </p>
            </div>
          )}
        </div>

        {/* ── Step 3 — Results ── */}
        <div
          className={`transition-opacity ${
            step3Active ? 'opacity-100' : 'opacity-40 pointer-events-none'
          }`}
        >
          <div className="flex items-center mb-4">
            <StepBadge n={3} done={false} />
            <span className="text-[13px] font-bold text-slate-900">Review your matches</span>
          </div>

          {step3Active && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-4 mb-5">
                {[
                  { label: 'Total contacts', value: contacts.length },
                  {
                    label: 'Unique companies',
                    value: new Set(contacts.map((c) => c.company).filter(Boolean)).size,
                  },
                  { label: 'Target companies', value: targetCompanies.length },
                  { label: 'Contacts at targets', value: matchedContacts.length, highlight: true },
                ].map(({ label, value, highlight }) => (
                  <div
                    key={label}
                    className={`bg-white rounded-lg border p-4 ${
                      highlight ? 'border-orange-400' : 'border-slate-200'
                    }`}
                  >
                    <div
                      className={`text-[22px] font-bold ${
                        highlight ? 'text-orange-500' : 'text-slate-900'
                      }`}
                    >
                      {value}
                    </div>
                    <div className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Toggle + Export */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-1">
                  <button
                    onClick={() => setViewMode('matches')}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded transition-colors ${
                      viewMode === 'matches'
                        ? 'bg-orange-500 text-slate-900'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Target matches ({matchedContacts.length})
                  </button>
                  <button
                    onClick={() => setViewMode('all')}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded transition-colors ${
                      viewMode === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    All contacts ({contacts.length})
                  </button>
                </div>
                <div className="flex gap-2">
                  {matchedContacts.length > 0 && (
                    <button
                      onClick={() => handleExport(true)}
                      className="bg-orange-500 text-slate-900 text-[12px] font-bold px-4 py-2 rounded hover:bg-orange-400 transition-colors"
                    >
                      Export matches
                    </button>
                  )}
                  <button
                    onClick={() => handleExport(false)}
                    className="bg-slate-900 text-white text-[12px] font-bold px-4 py-2 rounded hover:bg-slate-700 transition-colors"
                  >
                    Export all
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Title</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Company</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Connected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedContacts.slice(0, 200).map((c, i) => {
                      const matchedTarget = findMatchingTarget(c, targetCompanies)
                      return (
                        <tr
                          key={i}
                          className={`border-b border-slate-100 hover:bg-slate-50 ${
                            matchedTarget ? 'bg-orange-50' : ''
                          }`}
                        >
                          <td className="px-4 py-2.5 font-medium text-slate-900">{c.name}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {c.title ?? <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {c.company ? (
                              matchedTarget ? (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-orange-600">
                                  <CompanyLogo logo={matchedTarget.logo} name={matchedTarget.name} />
                                  {c.company}
                                </span>
                              ) : (
                                <span className="text-slate-600">{c.company}</span>
                              )
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {c.email ?? <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-400">
                            {c.connected_on ?? <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {displayedContacts.length > 200 && (
                  <div className="px-4 py-3 text-[12px] text-slate-400 border-t border-slate-100">
                    Showing first 200 of {displayedContacts.length}. Export JSON to see all.
                  </div>
                )}
                {displayedContacts.length === 0 && (
                  <div className="px-4 py-8 text-[13px] text-slate-400 text-center">
                    {viewMode === 'matches'
                      ? 'No contacts found at your target companies. Try adding more or check spelling.'
                      : 'No contacts loaded.'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
