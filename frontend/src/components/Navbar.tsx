import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const onLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link to="/dashboard" className="font-semibold text-gray-900">
          Scheduler
        </Link>
        {user && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link to="/connections" className="text-gray-600 hover:text-gray-900">
              Connections
            </Link>
            <span className="hidden text-gray-600 sm:inline">{user.email}</span>
            <button onClick={onLogout} className="text-indigo-600 hover:underline">
              Log out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
