import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { UpdateBar } from './components/UpdateBar'

const root = createRoot(document.getElementById('root')!)

function render(applyUpdate?: () => Promise<void>) {
  root.render(
    <StrictMode>
      <App />
      {applyUpdate && <UpdateBar onReload={applyUpdate} />}
    </StrictMode>,
  )
}

render()

// The offline shell exists only in production builds: `npm run dev` and the
// tests never register a service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const updateServiceWorker = registerSW({
    onNeedRefresh: () => render(() => updateServiceWorker(true)),
    onRegisterError: (err: unknown) => {
      console.error('Service worker registration failed:', err)
    },
  })
}
