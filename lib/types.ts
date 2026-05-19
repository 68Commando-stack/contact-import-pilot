export interface ImportedContact {
  name: string
  email: string | null
  title: string | null
  company: string | null
  source: 'gmail' | 'outlook' | 'linkedin_csv'
  source_id: string | null
  connected_on: string | null
}
