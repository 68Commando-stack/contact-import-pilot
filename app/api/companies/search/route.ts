import { NextRequest, NextResponse } from 'next/server'

interface ClearbitSuggestion {
  name: string
  domain: string
  logo: string
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q) {
    return NextResponse.json([], { status: 200 })
  }

  try {
    const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'contact-import-pilot/1.0' },
      next: { revalidate: 60 },
    })

    if (!res.ok) {
      return NextResponse.json([], { status: 200 })
    }

    const data: ClearbitSuggestion[] = await res.json()

    const companies = data.slice(0, 8).map((item) => ({
      name: item.name,
      domain: item.domain,
      logo: item.logo ?? null,
    }))

    return NextResponse.json(companies)
  } catch {
    // Return empty list rather than error — search is best-effort
    return NextResponse.json([], { status: 200 })
  }
}
