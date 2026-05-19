import Papa from 'papaparse'
import { ImportedContact } from './types'

interface LinkedInRow {
  'First Name': string
  'Last Name': string
  'Email Address': string
  'Company': string
  'Position': string
  'Connected On': string
  [key: string]: string
}

/**
 * LinkedIn exports Connections.csv with a preamble before the real data:
 *
 *   Notes:
 *   -- Your connections on LinkedIn. ...
 *
 *   First Name,Last Name,URL,Email Address,Company,Position,Connected On
 *   Jane,Doe,...
 *
 * We skip everything before the line that starts with "First Name".
 */
function stripLinkedInPreamble(csvText: string): string {
  const lines = csvText.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    line.trimStart().startsWith('First Name')
  )
  if (headerIndex === -1) return csvText   // no preamble found — parse as-is
  return lines.slice(headerIndex).join('\n')
}

export function parseLinkedInCSV(csvText: string): ImportedContact[] {
  const cleaned = stripLinkedInPreamble(csvText)

  const result = Papa.parse<LinkedInRow>(cleaned, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  return result.data
    .filter((row) => row['First Name'] || row['Last Name'])
    .map((row, i) => {
      const firstName = (row['First Name'] || '').trim()
      const lastName = (row['Last Name'] || '').trim()
      const name = [firstName, lastName].filter(Boolean).join(' ')

      return {
        name,
        email: row['Email Address']?.trim() || null,
        title: row['Position']?.trim() || null,
        company: row['Company']?.trim() || null,
        source: 'linkedin_csv' as const,
        source_id: `linkedin-${i}-${name.toLowerCase().replace(/\s+/g, '-')}`,
        connected_on: row['Connected On']?.trim() || null,
      }
    })
}
