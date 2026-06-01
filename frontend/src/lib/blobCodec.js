// Base64 data-URL <-> Blob conversion for demo mode: signature uploads come
// back from the server as a base64 PNG (data URL) to store as a Blob, and the
// stored Blob is turned back into a data URL to ship inline with an export.

export function dataUrlToBlob(dataUrl) {
  const [head, b64 = ''] = String(dataUrl).split(',', 2)
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
