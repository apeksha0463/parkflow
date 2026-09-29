import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { LoginPage, RegisterPage } from './pages/Auth'
import NotFound from './pages/NotFound'

// Map-heavy pages are split out so the auth pages stay light.
const Landing = lazy(() => import('./pages/Landing'))
const Explore = lazy(() => import('./pages/Explore'))
const FacilityPage = lazy(() => import('./pages/FacilityPage'))

function PageFallback() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <span className="size-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/parking/:id" element={<FacilityPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
