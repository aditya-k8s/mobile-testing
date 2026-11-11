import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'

interface Parent {
  id: string
  email: string
  name: string
}

interface AuthValue {
  parent: Parent | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [parent, setParent] = useState<Parent | null>(null)
  const [loading, setLoading] = useState(!!getToken())

  const loadMe = useCallback(async () => {
    try {
      setParent(await api<Parent>('/api/auth/me'))
    } catch {
      setToken(null)
      setParent(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (getToken()) void loadMe()
    const onLogout = () => setParent(null)
    window.addEventListener('fm:logout', onLogout)
    return () => window.removeEventListener('fm:logout', onLogout)
  }, [loadMe])

  const login = async (email: string, password: string) => {
    const { access_token } = await api<{ access_token: string }>('/api/auth/login', { method: 'POST', body: { email, password } })
    setToken(access_token)
    await loadMe()
  }

  const register = async (name: string, email: string, password: string) => {
    const { access_token } = await api<{ access_token: string }>('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    })
    setToken(access_token)
    await loadMe()
  }

  const logout = () => {
    setToken(null)
    setParent(null)
  }

  return <AuthContext.Provider value={{ parent, loading, login, register, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
