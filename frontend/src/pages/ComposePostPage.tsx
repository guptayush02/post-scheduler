import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createPost,
  getPost,
  listSocialAccounts,
  parseApiDate,
  updatePost,
  type Platform,
  type PostStatus,
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
  const [alsoPostToInstagram, setAlsoPostToInstagram] = useState(false)
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [media, setMedia] = useState<File | null>(null)
  const [existingMediaPath, setExistingMediaPath] = useState<string | null>(null)
  const [postStatus, setPostStatus] = useState<PostStatus | null>(null)
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
          setAlsoPostToInstagram(post.also_post_to_instagram)
          setExistingMediaPath(post.media_path)
          setPostStatus(post.status)
        }
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false))
  }, [id])

  const selectedAccount = accounts.find((a) => a.id === socialAccountId)
  const canCrossPostToInstagram = Boolean(selectedAccount?.instagram_username)

  const onAccountChange = (value: string) => {
    setSocialAccountId(value)
    const account = accounts.find((a) => a.id === value)
    if (!account?.instagram_username) setAlsoPostToInstagram(false)
  }

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
        also_post_to_instagram: alsoPostToInstagram && canCrossPostToInstagram,
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
      {(postStatus === 'published' || postStatus === 'failed') && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This post already {postStatus === 'published' ? 'went out' : 'failed to publish'}. Saving
          will re-schedule it for the date/time below as a fresh publish attempt — any previous
          Facebook/Instagram post stays as-is.
        </p>
      )}
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
              onChange={(e) => onAccountChange(e.target.value)}
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

        {canCrossPostToInstagram && (
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="also_post_to_instagram"
              checked={alsoPostToInstagram}
              onChange={(e) => setAlsoPostToInstagram(e.target.checked)}
              className="mt-0.5"
            />
            <label htmlFor="also_post_to_instagram" className="text-sm text-gray-700">
              Also post to Instagram (@{selectedAccount?.instagram_username})
              <span className="block text-xs text-gray-500">
                Requires an image or video, and a public media URL to be configured on the backend.
              </span>
            </label>
          </div>
        )}

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
            Informational only — the account picker above (and the Instagram checkbox) controls
            where this actually gets published.
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
            {submitting
              ? 'Saving...'
              : isEdit
                ? postStatus === 'published' || postStatus === 'failed'
                  ? 'Save & reschedule'
                  : 'Save changes'
                : 'Schedule post'}
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
