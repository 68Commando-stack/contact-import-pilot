import { NextRequest, NextResponse } from 'next/server'
import { parseLinkedInCSV } from '@/lib/normalize-linkedin'

export async function POST(request: NextRequest) {
  try {
    const csvText = await request.text()
    if (!csvText || csvText.trim().length === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    }

    const contacts = parseLinkedInCSV(csvText)

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: 'No contacts found. Make sure you uploaded the LinkedIn Connections.csv file.' },
        { status: 400 }
      )
    }

    return NextResponse.json({ contacts, count: contacts.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
