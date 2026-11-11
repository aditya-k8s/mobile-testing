import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import { LiveProvider } from './lib/live'
import Activity from './pages/Activity'
import AppUsage from './pages/AppUsage'
import LiveScreen from './pages/LiveScreen'
import Login from './pages/Login'
import MyChild from './pages/MyChild'
import ScreenTime from './pages/ScreenTime'
import Settings from './pages/Settings'

function Gate() {
  const { parent, loading } = useAuth()
  if (loading) return <p className="muted center">Loading…</p>
  if (!parent) return <Login />
  return (
    <LiveProvider key={parent.id}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MyChild />} />
          <Route path="live" element={<LiveScreen />} />
          <Route path="apps" element={<AppUsage />} />
          <Route path="screen-time" element={<ScreenTime />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LiveProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
