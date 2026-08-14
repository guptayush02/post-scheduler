import { parseApiDate, type Post } from '../api/client'

export default function PostPreviewModal({ post, onClose }: { post: Post; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Post preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {post.media_url && post.media_type === 'image' && (
          <img
            src={post.media_url}
            alt=""
            className="mt-4 max-h-96 w-full rounded-md object-contain bg-gray-100"
          />
        )}
        {post.media_url && post.media_type === 'video' && (
          <video
            src={post.media_url}
            controls
            className="mt-4 max-h-96 w-full rounded-md bg-gray-100"
          />
        )}
        {!post.media_url && (
          <p className="mt-4 text-sm text-gray-400 italic">No media attached</p>
        )}

        <p className="mt-4 whitespace-pre-wrap text-sm text-gray-900">{post.caption}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-100 pt-4 text-xs text-gray-500">
          <dt>Scheduled for</dt>
          <dd className="text-gray-900">{parseApiDate(post.scheduled_at).toLocaleString()}</dd>
          <dt>Status</dt>
          <dd className="text-gray-900">{post.status}</dd>
          {post.social_account_name && (
            <>
              <dt>Account</dt>
              <dd className="text-gray-900">{post.social_account_name}</dd>
            </>
          )}
          {post.also_post_to_instagram && (
            <>
              <dt>Instagram</dt>
              <dd className="text-gray-900">
                {post.instagram_post_id ? 'posted' : post.instagram_error ? post.instagram_error : 'pending'}
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  )
}
