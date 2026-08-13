import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { verifyEmail } from '../api/client'

type State = 'verifying' | 'success' | 'error'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState<State>('verifying')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setState('error')
      setError('Missing verification token')
      return
    }
    verifyEmail(token)
      .then(() => setState('success'))
      .catch((err) => {
        setState('error')
        setError(err?.response?.data?.detail ?? 'Verification failed')
      })
  }, [params])

  return (
    <div className="mx-auto mt-24 max-w-sm px-4 text-center">
      {state === 'verifying' && <p className="text-sm text-gray-600">Verifying your email...</p>}
      {state === 'success' && (
        <>
          <h1 className="text-xl font-semibold text-gray-900">Email verified</h1>
          <p className="mt-2 text-sm text-gray-600">
            You can now{' '}
            <Link to="/login" className="text-indigo-600 hover:underline">
              log in
            </Link>
            .
          </p>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 className="text-xl font-semibold text-gray-900">Verification failed</h1>
          <p className="mt-2 text-sm text-red-600">{error}</p>
        </>
      )}
    </div>
  )
}
