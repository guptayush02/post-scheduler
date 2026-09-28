import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createPost,
  getAiStatus,
  getPost,
  isVideoUrl,
  listReelTemplates,
  listSocialAccounts,
  parseApiDate,
  updatePost,
  type AiStatus,
  type Platform,
  type PostStatus,
  type ReelTemplate,
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

const MAX_REEL_FILES = 20 // must match posts.py's MAX_REEL_SOURCES
const MIN_REEL_SECONDS = 30
const MAX_REEL_SECONDS = 60

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
  const [mode, setMode] = useState<'media' | 'reel'>('media')
  const [reelImages, setReelImages] = useState<File[]>([])
  const [useAiVideo, setUseAiVideo] = useState(true)
  const [reelSeconds, setReelSeconds] = useState(45)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [templates, setTemplates] = useState<ReelTemplate[]>([])
  const [reelTemplate, setReelTemplate] = useState('')
  const [existingMediaPath, setExistingMediaPath] = useState<string | null>(null)
  const [postStatus, setPostStatus] = useState<PostStatus | null>(null)
  const [postErrorMessage, setPostErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const loadAccounts = listSocialAccounts().then(setAccounts)
    getAiStatus().then(setAiStatus).catch(() => setAiStatus(null))
    listReelTemplates().then(setTemplates).catch(() => setTemplates([]))
    const loadPost = id ? getPost(id) : Promise.resolve(null)

    Promise.all([loadAccounts, loadPost])
      .then(([, post]) => {
        if (post) {
          setCaption(post.caption)
          setScheduledAt(post.scheduled_at ? toDatetimeLocalValue(post.scheduled_at) : '')
          setPlatform(post.platform ?? '')
          setSocialAccountId(post.social_account_id ?? '')
          setAlsoPostToInstagram(post.also_post_to_instagram)
          setExistingMediaPath(post.media_path)
          setPostStatus(post.status)
          setPostErrorMessage(post.error_message)
        }
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false))
  }, [id])

  const selectedAccount = accounts.find((a) => a.id === socialAccountId)
  const canCrossPostToInstagram = Boolean(selectedAccount?.instagram_username)
  // While the reel is still being generated (or a generation attempt is
  // claimed/in flight), there's no video yet - saving here would set
  // scheduled_at and flip status to `scheduled` while media_path is still
  // null, orphaning the in-progress generation (poll_pending_reels only
  // looks at status=generating_video, so it would stop being picked up) and
  // the post would go out as a text-only post instead of the reel. A failed
  // generation has no video to edit either. Once it's a ready `draft`
  // (video attached), editing works like any other post.
  const isGenerating = postStatus === 'generating_video' || postStatus === 'processing'
  const isBlocked = isGenerating || postStatus === 'generation_failed'
  const reelImageCountValid = reelImages.length <= MAX_REEL_FILES

  const onAccountChange = (value: string) => {
    setSocialAccountId(value)
    const account = accounts.find((a) => a.id === value)
    if (!account?.instagram_username) setAlsoPostToInstagram(false)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (mode === 'reel' && !reelImageCountValid) {
      setError(`Pick at most ${MAX_REEL_FILES} images/videos for a reel`)
      return
    }

    setSubmitting(true)
    try {
      const input = {
        caption,
        // A new reel draft doesn't have a schedule time yet - that's picked
        // later, after preview, via the dashboard's Preview action.
        scheduled_at: mode === 'reel' && !isEdit ? null : toIsoString(scheduledAt),
        platform,
        social_account_id: socialAccountId,
        also_post_to_instagram: alsoPostToInstagram && canCrossPostToInstagram,
        media,
        generate_reel: mode === 'reel',
        reel_images: reelImages,
        use_ai_video: useAiVideo && Boolean(aiStatus?.enabled),
        reel_target_seconds: reelSeconds,
        reel_template: reelTemplate || null,
      }
      if (isEdit && id) {
        await updatePost(id, input)
        navigate('/dashboard')
      } else {
        const created = await createPost(input)
        // A reel renders in the background - its preview page shows it
        // arriving and is where it gets tweaked and scheduled.
        navigate(mode === 'reel' ? `/posts/${created.id}/preview` : '/dashboard')
      }
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
      {isGenerating && (
        <p className="mt-2 rounded-md bg-purple-50 px-3 py-2 text-sm text-purple-800">
          Generating the reel video in the background — this keeps going even if you leave this
          page, and can take a couple of minutes.
        </p>
      )}
      {postStatus === 'draft' && (
        <p className="mt-2 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          The reel video is ready — edit the caption if you want, pick a date &amp; time below and
          save to schedule it. You can also{' '}
          <Link to={`/posts/${id}/preview`} className="font-medium underline">
            open the preview
          </Link>{' '}
          to watch and tweak it first.
        </p>
      )}
      {postStatus === 'generation_failed' && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Reel generation failed{postErrorMessage ? `: ${postErrorMessage}` : ''}. Open{' '}
          <Link to={`/posts/${id}/preview`} className="font-medium underline">
            the preview
          </Link>{' '}
          to change the settings and retry.
        </p>
      )}
      <fieldset disabled={isBlocked} className="contents">
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

        {!isEdit && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Media</label>
            <div className="mt-1 flex gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mode === 'media'}
                  onChange={() => setMode('media')}
                />
                Upload media
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mode === 'reel'}
                  onChange={() => setMode('reel')}
                />
                Generate reel (30-60s video)
              </label>
            </div>
          </div>
        )}

        {mode === 'media' && (
          <div>
            {isEdit && <label className="block text-sm font-medium text-gray-700">Media (image or video)</label>}
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
        )}

        {mode === 'reel' && !isEdit && (
          <div>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => setReelImages(Array.from(e.target.files ?? []))}
              className="mt-1 w-full text-sm"
            />
            <p className={`mt-1 text-xs ${!reelImageCountValid ? 'text-red-600' : 'text-gray-500'}`}>
              Optional: up to {MAX_REEL_FILES} images and/or videos ({reelImages.length} selected).
              Leave empty to build the reel from the caption alone. Images get zoom/pan, videos are
              looped or trimmed to fit, with crossfades. Your caption stays in the post - add text onto
              the video itself from the preview page.
            </p>
            {reelImages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {reelImages.map((file, i) =>
                  isVideoUrl(file.name) ? (
                    <video
                      key={`${file.name}-${i}`}
                      src={URL.createObjectURL(file)}
                      muted
                      playsInline
                      className="h-14 w-14 rounded object-cover"
                    />
                  ) : (
                    <img
                      key={`${file.name}-${i}`}
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="h-14 w-14 rounded object-cover"
                    />
                  ),
                )}
              </div>
            )}

            <label className="mt-3 block text-xs font-medium text-gray-700">Template</label>
            <select
              value={reelTemplate}
              onChange={(e) => setReelTemplate(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.description}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              You can switch templates later on the preview page, with a live preview.
            </p>

            <label className="mt-3 block text-xs font-medium text-gray-700">
              Length: {reelSeconds}s
            </label>
            <input
              type="range"
              min={MIN_REEL_SECONDS}
              max={MAX_REEL_SECONDS}
              step={5}
              value={reelSeconds}
              onChange={(e) => setReelSeconds(Number(e.target.value))}
              className="w-full"
            />

            <div className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                id="use_ai_video"
                checked={useAiVideo && Boolean(aiStatus?.enabled)}
                disabled={!aiStatus?.enabled}
                onChange={(e) => setUseAiVideo(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="use_ai_video" className="text-sm text-gray-700">
                Add AI-generated video clip{(aiStatus?.video_clips ?? 1) > 1 ? 's' : ''} (Hugging Face)
                <span className="block text-xs text-gray-500">
                  {aiStatus?.enabled
                    ? `Uses ${aiStatus.video_model} - animates your first image, or generates from the caption. Uses your HF credits; if they run out the reel is still made without AI footage.`
                    : 'Not available - set HF_TOKEN on the backend to enable. Text-only reels will use title cards.'}
                </span>
              </label>
            </div>
          </div>
        )}

        {(mode === 'media' || isEdit) && (
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
        )}
        {mode === 'reel' && !isEdit && (
          <p className="text-xs text-gray-500">
            No schedule time yet — once the video's ready you'll preview it and pick a time from
            the dashboard.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || isBlocked}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting
              ? 'Saving...'
              : isEdit
                ? postStatus === 'published' || postStatus === 'failed'
                  ? 'Save & reschedule'
                  : postStatus === 'draft'
                    ? 'Save & schedule'
                    : 'Save changes'
                : mode === 'reel'
                  ? 'Save as draft & generate'
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
      </fieldset>
    </div>
  )
}
