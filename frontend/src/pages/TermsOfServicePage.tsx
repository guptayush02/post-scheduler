export default function TermsOfServicePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-900">Terms of Service</h1>
      <p className="mt-2 text-xs text-gray-500">Last updated: August 2026</p>

      <p className="mt-6">
        These terms govern your use of Scheduler ("the Service"), operated by Sutra
        Group. By creating an account, you agree to them.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">The Service</h2>
      <p className="mt-2">
        Scheduler lets you connect a Facebook Page (and any linked Instagram
        professional account) and schedule posts — with a caption and optional
        image/video — to be published automatically at a time you choose.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Your responsibilities</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li>You must own or have authorization to manage the Facebook Page/Instagram account you connect.</li>
        <li>You're responsible for the content you schedule — it must comply with Facebook's and Instagram's own Community Standards and Terms of Service.</li>
        <li>You won't use the Service to publish spam, unlawful, or infringing content.</li>
        <li>Keep your account credentials confidential; you're responsible for activity under your account.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Facebook/Instagram platform terms</h2>
      <p className="mt-2">
        Publishing happens via Meta's official Graph API. Your use of connected
        Facebook/Instagram accounts through this Service remains subject to Meta's own
        Platform Terms and Community Standards, independent of these terms.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Availability</h2>
      <p className="mt-2">
        The Service is provided "as is," without warranty of any kind. We aim for
        reliable scheduling but don't guarantee posts will always publish exactly on
        time — for example, if a connected account's token has expired and needs
        reconnecting, or if Meta's own APIs are unavailable.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Limitation of liability</h2>
      <p className="mt-2">
        To the fullest extent permitted by law, Sutra Group is not liable for indirect,
        incidental, or consequential damages arising from your use of the Service,
        including missed or delayed posts.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Termination</h2>
      <p className="mt-2">
        You may stop using the Service and disconnect your accounts at any time. We may
        suspend accounts that violate these terms or Meta's platform policies.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Governing law</h2>
      <p className="mt-2">These terms are governed by the laws of India.</p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Contact</h2>
      <p className="mt-2">
        <a href="mailto:sutragroupinfo@gmail.com" className="text-indigo-600 underline">
          sutragroupinfo@gmail.com
        </a>
      </p>
    </div>
  )
}
