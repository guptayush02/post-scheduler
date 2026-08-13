import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { resendVerification } from '../api/client'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resent, setResent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNeedsVerification(false)
    setResent(false)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err: any) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail ?? 'Login failed'
      setError(detail)
      if (status === 403) setNeedsVerification(true)
    } finally {
      setSubmitting(false)
    }
  }

  const onResend = async () => {
    await resendVerification(email)
    setResent(true)
  }

  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="text-xl font-semibold text-gray-900">Log in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {needsVerification && !resent && (
          <button
            type="button"
            onClick={onResend}
            className="text-sm text-indigo-600 hover:underline"
          >
            Resend verification email
          </button>
        )}
        {resent && <p className="text-sm text-green-600">Verification email sent.</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitting ? 'Logging in...' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        Don't have an account?{' '}
        <Link to="/signup" className="text-indigo-600 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
