import { currentUser } from '@clerk/nextjs/server'
import { Suspense } from 'react'

// TEMPORARY smoke-test page — delete after verifying Clerk server-side session access.
export default function MePage() {
  return (
    <Suspense fallback={<p className="p-8">Loading…</p>}>
      <Me />
    </Suspense>
  )
}

async function Me() {
  const user = await currentUser()

  if (!user) {
    return <p className="p-8">Signed out (server code ran fine).</p>
  }

  return (
    <p className="p-8">
      Signed in as {user.primaryEmailAddress?.emailAddress ?? user.username ?? user.id}
    </p>
  )
}
