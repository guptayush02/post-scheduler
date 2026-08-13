import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  disconnectSocialAccount,
  facebookConnectUrl,
  listSocialAccounts,
  parseApiDate,
  type SocialAccount,
} from '../api/client'

const ERROR_MESSAGES: Record<string, string> = {
  facebook_denied: 'Facebook connection was cancelled.',
  invalid_state: 'The connection request expired or was invalid. Please try again.',
  missing_code: 'Facebook did not return an authorization code. Please try again.',
  not_authenticated: 'Your session expired. Please log in and try again.',
  facebook_api_error: 'Facebook rejected the request. Check your app credentials and try again.',
  no_pages_found:
    "No Facebook Pages were granted access. When Facebook asks which Pages to allow, make sure to select at least one.",
}

export default function ConnectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)

  const connected = searchParams.get('connected')
  const error = searchParams.get('error')

  const load = async () => {
    setLoading(true)
    try {
      setAccounts(await listSocialAccounts())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const dismissBanner = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('connected')
    next.delete('error')
    setSearchParams(next, { replace: true })
  }

  const onDisconnect = async (id: string) => {
    if (!confirm('Disconnect this account? You can reconnect it any time.')) return
    await disconnectSocialAccount(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Connections</h1>
        <a
          href={facebookConnectUrl()}
          className="rounded-md bg-[#1877F2] px-3 py-2 text-sm font-medium text-white hover:bg-[#1565d8]"
        >
          Connect with Facebook
        </a>
      </div>

      {connected && (
        <div className="mt-4 flex items-center justify-between rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          <span>Account connected successfully.</span>
          <button onClick={dismissBanner} className="text-green-800 hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-center justify-between rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{ERROR_MESSAGES[error] ?? 'Something went wrong connecting your account.'}</span>
          <button onClick={dismissBanner} className="text-red-800 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <p className="mt-4 text-sm text-gray-500">
        Connecting brings in a Facebook Page and, if linked, its Instagram professional
        account — Instagram is managed through the Page, so there's no separate Instagram
        login.
      </p>

      {loading && <p className="mt-6 text-sm text-gray-500">Loading...</p>}

      {!loading && accounts.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">No accounts connected yet.</p>
      )}

      <ul className="mt-6 divide-y divide-gray-200">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{account.fb_page_name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {account.instagram_username ? `Instagram: @${account.instagram_username}` : 'No linked Instagram account'}
              </p>
              {account.status === 'needs_reauth' && (
                <p className="mt-1 text-xs text-red-600">
                  Needs reconnecting{account.last_error ? ` — ${account.last_error}` : ''}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Connected {parseApiDate(account.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-none items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  account.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {account.status === 'active' ? 'active' : 'needs reconnect'}
              </span>
              <button
                onClick={() => onDisconnect(account.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Disconnect
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
