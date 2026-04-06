"use client"
import { SessionProvider } from "next-auth/react"
import { useEffect } from "react"
import { signOut, useSession } from "next-auth/react"

function AuthWatcher() {
  const { data: session } = useSession()

  useEffect(() => {
    if (!session) return
    // Probe a lightweight authenticated endpoint; if 401, force re-login
    const token = (session as { accessToken?: string }).accessToken
    if (!token) return
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/notifications/count`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).then((res) => {
      if (res.status === 401) signOut({ callbackUrl: "/login" })
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthWatcher />
      {children}
    </SessionProvider>
  )
}
