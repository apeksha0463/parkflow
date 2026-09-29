import { createContext, useContext, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import type { User } from '../lib/types'

interface AuthValue {
  user: User | null
  loading: boolean
  login: (input: { email: string; password: string }) => Promise<User>
  register: (input: { name: string; email: string; password: string }) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)
const ME_KEY = ['auth', 'me']

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/api/auth/me')).user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })

  const onAuthed = (user: User) => {
    qc.setQueryData(ME_KEY, user)
    return user
  }
  const login = useMutation({
    mutationFn: async (input: { email: string; password: string }) => (await api<{ user: User }>('/api/auth/login', { method: 'POST', body: input })).user,
    onSuccess: onAuthed,
  })
  const register = useMutation({
    mutationFn: async (input: { name: string; email: string; password: string }) =>
      (await api<{ user: User }>('/api/auth/register', { method: 'POST', body: input })).user,
    onSuccess: onAuthed,
  })
  const logout = useMutation({
    mutationFn: () => api<void>('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.setQueryData(ME_KEY, null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'me' })
    },
  })

  const value: AuthValue = {
    user: me.data ?? null,
    loading: me.isLoading,
    login: login.mutateAsync,
    register: register.mutateAsync,
    logout: () => logout.mutateAsync(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
