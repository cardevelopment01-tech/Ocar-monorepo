import React, { useState } from 'react'

import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import SplashScreen from './components/ui/SplashScreen'
import './index.css'

function Root() {
  const [showSplash, setShowSplash] = useState(true)

  return (
    <>
      <SplashScreen show={showSplash} onComplete={() => setShowSplash(false)} />
      <div className="min-h-[100dvh] bg-[#0a0a0a]">
        <div
          className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative overflow-hidden"
          style={{ transform: 'translateZ(0)' }}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </div>
      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
