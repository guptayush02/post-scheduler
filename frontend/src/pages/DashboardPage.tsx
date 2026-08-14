import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deletePost, listPosts, parseApiDate, type Post, type PostStatus } from '../api/client'
import PostPreviewModal from '../components/PostPreviewModal'

const STATUS_STYLES: Record<PostStatus, string> = {
  scheduled: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  published: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

const PAGE_SIZE = 10

function formatDateTime(iso: string): string {
  return parseApiDate(iso).toLocaleString()
}

export default function DashboardPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewPost, setPreviewPost] = useState<Post | null>(null)

  const load = async (targetPage: number) => {
    try {
      const result = await listPosts(targetPage, PAGE_SIZE)
      setPosts(result.items)
      setTotalPages(result.total_pages)
      setTotal(result.total)
      // If posts got deleted and this page is now past the end, snap back.
      if (result.items.length === 0 && result.total > 0 && targetPage > result.total_pages) {
        setPage(result.total_pages)
      }
    } catch {
      setError('Failed to load posts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(page)
    const interval = setInterval(() => load(page), 15000)
    return () => clearInterval(interval)
  }, [page])

  const onDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return
    await deletePost(id)
    load(page)
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
            {post.media_url && post.media_type === 'image' && (
              <img
                src={post.media_url}
                alt=""
                className="h-16 w-16 flex-none rounded object-cover"
              />
            )}
            {post.media_url && post.media_type === 'video' && (
              <video src={post.media_url} className="h-16 w-16 flex-none rounded object-cover" />
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
              {post.also_post_to_instagram && (
                <p className="mt-1 text-xs">
                  {post.instagram_post_id && (
                    <span className="text-green-700">Instagram: posted</span>
                  )}
                  {post.instagram_error && (
                    <span className="text-red-600">Instagram: {post.instagram_error}</span>
                  )}
                  {!post.instagram_post_id && !post.instagram_error && (
                    <span className="text-gray-500">Instagram: pending</span>
                  )}
                </p>
              )}
            </div>
            <span
              className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[post.status]}`}
            >
              {post.status}
            </span>
            <div className="flex flex-none gap-3 text-sm">
              <button
                onClick={() => setPreviewPost(post)}
                className="text-gray-600 hover:underline"
              >
                Preview
              </button>
              <Link to={`/compose/${post.id}`} className="text-indigo-600 hover:underline">
                Edit
              </Link>
              <button onClick={() => onDelete(post.id)} className="text-red-600 hover:underline">
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {total > 0 && (
        <div className="mt-6 flex items-center justify-between text-sm text-gray-600">
          <span>
            Page {page} of {totalPages} &middot; {total} post{total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {previewPost && <PostPreviewModal post={previewPost} onClose={() => setPreviewPost(null)} />}
    </div>
  )
}
