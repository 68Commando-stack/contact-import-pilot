import { unzip } from 'fflate'

/**
 * Extracts Connections.csv from a LinkedIn data export ZIP file.
 * The extraction runs entirely in the browser — the ZIP never leaves
 * the user's device. All other files in the ZIP are ignored.
 */
export function extractConnectionsCSV(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      const uint8 = new Uint8Array(buffer)

      unzip(uint8, (err, files) => {
        if (err) {
          reject(
            new Error(
              'Could not read the ZIP file. Make sure it is the LinkedIn data export you received by email.'
            )
          )
          return
        }

        // Find Connections.csv — handle subdirectories and mixed casing
        const key = Object.keys(files).find((k) =>
          k.toLowerCase().endsWith('connections.csv')
        )

        if (!key) {
          reject(
            new Error(
              'Connections.csv was not found in this ZIP. Make sure you selected "Connections" when requesting your LinkedIn data export.'
            )
          )
          return
        }

        const text = new TextDecoder('utf-8').decode(files[key])
        resolve(text)
      })
    }

    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsArrayBuffer(file)
  })
}
