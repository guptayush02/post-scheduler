export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-900">Privacy Policy</h1>
      <p className="mt-2 text-xs text-gray-500">Last updated: August 2026</p>

      <p className="mt-6">
        Scheduler ("we", "our", "the Service") is a social media post scheduling tool
        operated by Sutra Group. This page explains what information we collect, why,
        and how you can have it removed.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Information we collect</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li>
          <strong>Account information:</strong> the email address and password (stored as
          a salted hash, never in plain text) you sign up with.
        </li>
        <li>
          <strong>Facebook/Instagram connection data:</strong> when you connect a
          Facebook Page (and any linked Instagram professional account), we store the
          Page/account ID and name, and the access tokens Meta issues for them. Tokens
          are encrypted at rest and used only to publish the posts you schedule through
          this app.
        </li>
        <li>
          <strong>Content you create:</strong> captions, images, and videos you upload to
          schedule a post are stored so the background scheduler can publish them at the
          time you choose.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">How we use this information</h2>
      <p className="mt-2">
        Solely to operate the Service: authenticating you, publishing your scheduled
        posts to the Facebook Page and/or Instagram account you connected, and keeping
        your connection active (refreshing tokens before they expire). We do not sell
        your data, use it for advertising, or share it with third parties other than
        Meta's own APIs (Facebook Graph API / Instagram Graph API), which are required
        to actually publish your posts.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Data retention and deletion</h2>
      <p className="mt-2">
        Your data is kept for as long as your account exists. You can disconnect a
        Facebook/Instagram account at any time from the Connections page, which removes
        its stored tokens immediately. To request full deletion of your account and all
        associated data (posts, media, connected account records), email{' '}
        <a href="mailto:sutragroupinfo@gmail.com" className="text-indigo-600 underline">
          sutragroupinfo@gmail.com
        </a>{' '}
        from the email address on your account — we will delete it within 30 days and
        confirm by email.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Security</h2>
      <p className="mt-2">
        Passwords are hashed with bcrypt. Facebook/Instagram access tokens are encrypted
        at rest. All traffic to the Service is served over HTTPS.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Contact</h2>
      <p className="mt-2">
        Questions about this policy or your data:{' '}
        <a href="mailto:sutragroupinfo@gmail.com" className="text-indigo-600 underline">
          sutragroupinfo@gmail.com
        </a>
      </p>
    </div>
  )
}
