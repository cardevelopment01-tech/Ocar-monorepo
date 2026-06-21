import React from 'react'

import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="min-h-[100dvh] bg-[#0a0a0a]">
      <div className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative overflow-hidden">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </div>
    </div>
  </React.StrictMode>
)
