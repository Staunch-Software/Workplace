// src/modules/vp/VpRenderPage.jsx
// Address /vp-render. Only the server's headless browser opens this page: it sets window.__VP_RENDER_TOKEN__
// (a short-lived, read-only token) before the page loads and calls window.__vpGenerateVoyagePdf to build the
// voyage-completion report exactly as the Logbook+ download does (backend/mariapps_pipeline/voyage_report_pdf.py).
// The page shows nothing and the API rejects any request that has no valid token.
import React, { useEffect } from 'react'
import './index.css'
import './App.css'
import { generateVoyagePdf } from './utils/voyagePdfExport'

export default function VpRenderPage() {
  useEffect(() => {
    window.__vpGenerateVoyagePdf = (args) => generateVoyagePdf({ ...args, returnData: true })
    return () => { delete window.__vpGenerateVoyagePdf }
  }, [])
  return <div className="vp-root" />
}
