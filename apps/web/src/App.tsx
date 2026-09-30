import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { LoginPage, RegisterPage } from './pages/Auth'
import NotFound from './pages/NotFound'

// Map- and chart-heavy pages are split out.
const Overview = lazy(() => import('./pages/Overview'))
const ParkingMap = lazy(() => import('./pages/ParkingMap'))
const Spillover = lazy(() => import('./pages/Spillover'))
const Research = lazy(() => import('./pages/Research'))

function PageFallback() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <span className="size-6 animate-spin rounded-full border-2 border-ink-800 border-t-transparent" />
    </div>
  )
}

/** Old zone links (/parking/:id) open the zone in Spillover Intelligence. */
function LegacyZone() {
  const { id } = useParams()
  return <Navigate to={`/spillover?zone=${id}`} replace />
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/map" element={<ParkingMap />} />
        <Route path="/spillover" element={<Spillover />} />
        <Route path="/research" element={<Research />} />
        <Route path="/explore" element={<Navigate to="/map" replace />} />
        <Route path="/parking/:id" element={<LegacyZone />} />
        {/* Accounts are optional; the session check only runs on these pages. */}
        <Route path="/login" element={<AuthProvider><LoginPage /></AuthProvider>} />
        <Route path="/register" element={<AuthProvider><RegisterPage /></AuthProvider>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
