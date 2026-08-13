import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deletePost, listPosts, parseApiDate, type Post, type PostStatus } from '../api/client'

const STATUS_STYLES: Record<PostStatus, string> = {
  scheduled: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

function formatDateTime(iso: string): string {
  return parseApiDate(iso).toLocaleString()
}

export default function DashboardPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setPosts(await listPosts())
    } catch {
      setError('Failed to load posts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  const onDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return
    await deletePost(id)
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Scheduled posts</h1>
        <Link
          to="/compose"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New post
        </Link>
      </div>

      {loading && <p className="mt-6 text-sm text-gray-500">Loading...</p>}
      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

      {!loading && posts.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          No posts yet.{' '}
          <Link to="/compose" className="text-indigo-600 hover:underline">
            Schedule your first one
          </Link>
          .
        </p>
      )}

      <ul className="mt-6 divide-y divide-gray-200">
        {posts.map((post) => (
          <li key={post.id} className="flex items-center gap-4 py-4">
            {post.media_path && post.media_type === 'image' && (
              <img
                src={`/${post.media_path}`}
                alt=""
                className="h-16 w-16 flex-none rounded object-cover"
              />
            )}
            {post.media_path && post.media_type === 'video' && (
              <video src={`/${post.media_path}`} className="h-16 w-16 flex-none rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{post.caption}</p>
              <p className="mt-1 text-xs text-gray-500">
                {formatDateTime(post.scheduled_at)}
                {post.platform && <> &middot; {post.platform.replace('_', ' ')}</>}
                {post.social_account_name && <> &middot; {post.social_account_name}</>}
              </p>
              {post.status === 'failed' && post.error_message && (
                <p className="mt-1 text-xs text-red-600">{post.error_message}</p>
              )}
            </div>
            <span
              className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[post.status]}`}
            >
              {post.status}
            </span>
            {post.status === 'scheduled' && (
              <div className="flex flex-none gap-3 text-sm">
                <Link to={`/compose/${post.id}`} className="text-indigo-600 hover:underline">
                  Edit
                </Link>
                <button onClick={() => onDelete(post.id)} className="text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
