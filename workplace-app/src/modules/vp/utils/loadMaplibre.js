// MapLibre GL is loaded from a CDN, not from npm: the bundled build breaks its web worker when minified
// ("wm is not defined"). The Fleet Status map reads window.maplibregl.
const VERSION = '5.3.0'
const BASE = `https://unpkg.com/maplibre-gl@${VERSION}/dist`

let pending = null

export function loadMaplibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl)
  if (pending) return pending
  pending = new Promise((resolve) => {
    if (!document.querySelector('link[data-vp-maplibre]')) {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = `${BASE}/maplibre-gl.css`
      css.dataset.vpMaplibre = '1'
      document.head.appendChild(css)
    }
    const js = document.createElement('script')
    js.src = `${BASE}/maplibre-gl.js`
    js.async = true
    js.onload = () => resolve(window.maplibregl)
    js.onerror = () => { pending = null; resolve(null) }   // the rest of the module works without the map
    document.head.appendChild(js)
  })
  return pending
}
