import { currentUser } from '@clerk/nextjs/server'

// TEMPORARY smoke-test page — delete after verifying Clerk server-side session access.
export default async function MePage() {
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
