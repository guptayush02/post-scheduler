import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { resendVerification } from '../api/client'

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function ConnectIcon() {
  return (
    <svg {...ICON_PROPS} className="h-6 w-6">
      <circle cx="7" cy="12" r="3.2" />
      <circle cx="17" cy="12" r="3.2" />
      <line x1="10.2" y1="12" x2="13.8" y2="12" />
    </svg>
  )
}

function WriteIcon() {
  return (
    <svg {...ICON_PROPS} className="h-6 w-6">
      <rect x="4" y="3.5" width="13" height="17" rx="2" />
      <line x1="7.5" y1="8" x2="13.5" y2="8" />
      <line x1="7.5" y1="12" x2="13.5" y2="12" />
      <line x1="7.5" y1="16" x2="11" y2="16" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg {...ICON_PROPS} className="h-6 w-6">
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  )
}

function PhotoIcon() {
  return (
    <svg {...ICON_PROPS} className="h-6 w-6">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <polyline points="4.5 17 10 11.5 14 15.5 16.5 13.5 19.5 16.5" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg {...ICON_PROPS} className="h-6 w-6">
      <rect x="3" y="6" width="12.5" height="12" rx="2" />
      <polygon points="15.5 10 21 7 21 17 15.5 14" />
    </svg>
  )
}

function RepeatIcon() {
  return (
    <svg {...ICON_PROPS} className="h-6 w-6">
      <path d="M19.5 12a7.5 7.5 0 0 1-12.9 5.2" />
      <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2" />
      <polyline points="4.5 8 4.5 12 8.5 12" />
      <polyline points="19.5 16 19.5 12 15.5 12" />
    </svg>
  )
}

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <ConnectIcon />,
    title: '1. Connect your account',
    body: 'Log in with Facebook once and pick the Page you post from. Any Instagram professional account linked to that Page comes along with it.',
  },
  {
    icon: <WriteIcon />,
    title: '2. Write your post',
    body: 'Add your caption and attach a photo or video — or let Scheduler build a short reel for you out of a few images.',
  },
  {
    icon: <ClockIcon />,
    title: '3. Pick a date and time',
    body: "Choose when it should go out. Scheduler publishes it for you at that time, even if you're not online.",
  },
]

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <PhotoIcon />,
    title: 'Facebook and Instagram together',
    body: 'Post to your Facebook Page and cross-post the same content to your linked Instagram account in one go.',
  },
  {
    icon: <VideoIcon />,
    title: 'Turn photos into a reel',
    body: 'Pick a few photos and Scheduler builds a short vertical video with zoom, transitions and your own background music.',
  },
  {
    icon: <RepeatIcon />,
    title: 'Edit or reschedule anytime',
    body: 'Change the caption, swap the media or move a post to a different time — right up until it goes out.',
  },
]

function PostMockup() {
  return (
    <div className="mx-auto w-full max-w-xs rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-indigo-100" />
        <div className="flex-1">
          <div className="h-2.5 w-24 rounded bg-gray-200" />
          <div className="mt-1.5 h-2 w-16 rounded bg-gray-100" />
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
          scheduled
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-2 w-full rounded bg-gray-100" />
        <div className="h-2 w-4/5 rounded bg-gray-100" />
      </div>
      <div className="mt-3 flex h-28 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-100 to-indigo-50 text-indigo-300">
        <PhotoIcon />
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
        <ClockIcon />
        <span>Goes out tomorrow, 9:00 AM</span>
      </div>
    </div>
  )
}

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
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="grid items-start gap-10 md:grid-cols-2">
        <div>
          <h1 className="text-3xl font-semibold leading-tight text-gray-900">
            Schedule your Facebook and Instagram posts ahead of time
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-gray-600">
            Scheduler lets you write a post once, attach a photo or video, and pick the date and
            time it should go live. It publishes to your own Facebook Page and linked Instagram
            account automatically — so you don't have to be at your phone when the moment comes.
          </p>
          <div className="mt-8">
            <PostMockup />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Log in</h2>
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
      </div>

      <section className="mt-16 border-t border-gray-200 pt-12">
        <h2 className="text-center text-xl font-semibold text-gray-900">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                {step.icon}
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-center text-xl font-semibold text-gray-900">What you can do</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                {feature.icon}
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-12 text-center text-xs text-gray-400">
        <Link to="/privacy" className="hover:underline">
          Privacy Policy
        </Link>{' '}
        &middot;{' '}
        <Link to="/terms" className="hover:underline">
          Terms of Service
        </Link>
      </p>
    </div>
  )
}
