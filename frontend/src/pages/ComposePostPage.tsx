import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createPost,
  getPost,
  listSocialAccounts,
  parseApiDate,
  updatePost,
  type Platform,
  type SocialAccount,
} from '../api/client'

function toDatetimeLocalValue(iso: string): string {
  const d = parseApiDate(iso)
  const offsetMs = d.getTimezoneOffset() * 60000
  const local = new Date(d.getTime() - offsetMs)
  return local.toISOString().slice(0, 16)
}

function toIsoString(datetimeLocalValue: string): string {
  return new Date(datetimeLocalValue).toISOString()
}

const PLATFORM_OPTIONS: { value: Platform | ''; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'facebook_page', label: 'Facebook Page post' },
  { value: 'instagram_post', label: 'Instagram post' },
  { value: 'instagram_reel', label: 'Instagram reel' },
]

function accountLabel(account: SocialAccount): string {
  return account.instagram_username
    ? `${account.fb_page_name} (+ Instagram @${account.instagram_username})`
    : account.fb_page_name
}

export default function ComposePostPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [caption, setCaption] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [socialAccountId, setSocialAccountId] = useState('')
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [media, setMedia] = useState<File | null>(null)
  const [existingMediaPath, setExistingMediaPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const loadAccounts = listSocialAccounts().then(setAccounts)
    const loadPost = id ? getPost(id) : Promise.resolve(null)

    Promise.all([loadAccounts, loadPost])
      .then(([, post]) => {
        if (post) {
          setCaption(post.caption)
          setScheduledAt(toDatetimeLocalValue(post.scheduled_at))
          setPlatform(post.platform ?? '')
          setSocialAccountId(post.social_account_id ?? '')
          setExistingMediaPath(post.media_path)
        }
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false))
  }, [id])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const input = {
        caption,
        scheduled_at: toIsoString(scheduledAt),
        platform,
        social_account_id: socialAccountId,
        media,
      }
      if (isEdit && id) {
        await updatePost(id, input)
      } else {
        await createPost(input)
      }
      navigate('/dashboard')
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save post')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="mt-24 text-center text-sm text-gray-500">Loading...</div>
  }

  return (
    <div className="mx-auto mt-12 max-w-lg px-4">
      <h1 className="text-xl font-semibold text-gray-900">
        {isEdit ? 'Edit post' : 'Schedule a post'}
      </h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Caption</label>
          <textarea
            required
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Post to</label>
          {accounts.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              No accounts connected yet.{' '}
              <Link to="/connections" className="text-indigo-600 hover:underline">
                Connect a Facebook Page
              </Link>{' '}
              to pick one here.
            </p>
          ) : (
            <select
              value={socialAccountId}
              onChange={(e) => setSocialAccountId(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Not set</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountLabel(account)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Platform</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform | '')}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Not published anywhere yet — this is captured for when social publishing is wired up.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Media (image or video)</label>
          {existingMediaPath && !media && (
            <p className="mt-1 text-xs text-gray-500">Current file: {existingMediaPath.split('/').pop()}</p>
          )}
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => setMedia(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Date &amp; time</label>
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : isEdit ? 'Save changes' : 'Schedule post'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
