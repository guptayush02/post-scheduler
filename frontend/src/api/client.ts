import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// The backend always stores/returns UTC instants, but MongoDB strips timezone
// info from datetimes, so ISO strings from the API arrive without a "Z" or
// offset (e.g. "2026-08-20T04:00:00"). Treat any such string as UTC.
export function parseApiDate(iso: string): Date {
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(iso)
  return new Date(hasTimezone ? iso : `${iso}Z`)
}

export type Platform = 'facebook_page' | 'instagram_reel' | 'instagram_post'
export type PostStatus = 'scheduled' | 'published' | 'failed'
export type MediaType = 'image' | 'video'

export interface User {
  id: string
  email: string
  is_verified: boolean
}

export interface Post {
  id: string
  caption: string
  media_path: string | null
  media_type: MediaType | null
  platform: Platform | null
  social_account_id: string | null
  social_account_name: string | null
  scheduled_at: string
  status: PostStatus
  published_at: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export async function signup(email: string, password: string): Promise<User> {
  const res = await api.post<User>('/auth/signup', { email, password })
  return res.data
}

export async function login(email: string, password: string): Promise<User> {
  const res = await api.post<User>('/auth/login', { email, password })
  return res.data
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

export async function fetchMe(): Promise<User> {
  const res = await api.get<User>('/auth/me')
  return res.data
}

export async function verifyEmail(token: string): Promise<User> {
  const res = await api.get<User>('/auth/verify-email', { params: { token } })
  return res.data
}

export async function resendVerification(email: string): Promise<void> {
  await api.post('/auth/resend-verification', { email })
}

export async function listPosts(): Promise<Post[]> {
  const res = await api.get<Post[]>('/posts')
  return res.data
}

export async function getPost(id: string): Promise<Post> {
  const res = await api.get<Post>(`/posts/${id}`)
  return res.data
}

export interface PostFormInput {
  caption: string
  scheduled_at: string
  platform: Platform | ''
  social_account_id?: string | ''
  media?: File | null
}

function toFormData(input: PostFormInput): FormData {
  const form = new FormData()
  form.append('caption', input.caption)
  form.append('scheduled_at', input.scheduled_at)
  if (input.platform) form.append('platform', input.platform)
  if (input.social_account_id) form.append('social_account_id', input.social_account_id)
  if (input.media) form.append('media', input.media)
  return form
}

export async function createPost(input: PostFormInput): Promise<Post> {
  const res = await api.post<Post>('/posts', toFormData(input), {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function updatePost(id: string, input: PostFormInput): Promise<Post> {
  const res = await api.put<Post>(`/posts/${id}`, toFormData(input), {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function deletePost(id: string): Promise<void> {
  await api.delete(`/posts/${id}`)
}

export type ConnectionStatus = 'active' | 'needs_reauth'

export interface SocialAccount {
  id: string
  fb_page_id: string
  fb_page_name: string
  instagram_username: string | null
  status: ConnectionStatus
  last_error: string | null
  created_at: string
  updated_at: string
}

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const res = await api.get<SocialAccount[]>('/social/accounts')
  return res.data
}

export async function disconnectSocialAccount(id: string): Promise<void> {
  await api.delete(`/social/accounts/${id}`)
}

export function facebookConnectUrl(): string {
  return `${import.meta.env.VITE_API_BASE_URL}/api/social/facebook/connect`
}
