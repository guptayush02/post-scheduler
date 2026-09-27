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
export type PostStatus =
  | 'generating_video'
  | 'draft'
  | 'generation_failed'
  | 'scheduled'
  | 'processing'
  | 'published'
  | 'failed'
export type MediaType = 'image' | 'video'

export interface ReelTextLayer {
  text: string
  font_size: number
  color: string
  position: string
}

export const REEL_TEXT_POSITIONS: { value: string; label: string }[] = [
  { value: 'top_left', label: 'Top left' },
  { value: 'top_center', label: 'Top center' },
  { value: 'top_right', label: 'Top right' },
  { value: 'middle_left', label: 'Middle left' },
  { value: 'middle_center', label: 'Middle center' },
  { value: 'middle_right', label: 'Middle right' },
  { value: 'bottom_left', label: 'Bottom left' },
  { value: 'bottom_center', label: 'Bottom center' },
  { value: 'bottom_right', label: 'Bottom right' },
]

export const REEL_MIN_FONT_SIZE = 16
export const REEL_MAX_FONT_SIZE = 120
export const REEL_MAX_TEXT_LAYERS = 5

export const REEL_COLOR_FILTERS: { value: string; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'muted', label: 'Muted' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'bw', label: 'Black & white' },
]

export type ReelZoomStyle = 'zoom_in' | 'zoom_out' | 'none'
export const REEL_ZOOM_STYLES: { value: ReelZoomStyle; label: string }[] = [
  { value: 'zoom_in', label: 'Zoom in' },
  { value: 'zoom_out', label: 'Zoom out' },
  { value: 'none', label: 'No zoom' },
]

// Every crossfade transition ffmpeg's xfade filter supports - mirrors
// backend/app/services/reel_generator.py's XFADE_TRANSITIONS exactly.
export const REEL_TRANSITIONS: { value: string; label: string }[] = [
  { value: 'fade', label: 'Fade' },
  { value: 'fadeblack', label: 'Fade through black' },
  { value: 'fadewhite', label: 'Fade through white' },
  { value: 'fadegrays', label: 'Fade through grayscale' },
  { value: 'fadefast', label: 'Fast fade' },
  { value: 'fadeslow', label: 'Slow fade' },
  { value: 'distance', label: 'Distance' },
  { value: 'radial', label: 'Radial' },
  { value: 'wipeleft', label: 'Wipe left' },
  { value: 'wiperight', label: 'Wipe right' },
  { value: 'wipeup', label: 'Wipe up' },
  { value: 'wipedown', label: 'Wipe down' },
  { value: 'wipetl', label: 'Wipe top-left' },
  { value: 'wipetr', label: 'Wipe top-right' },
  { value: 'wipebl', label: 'Wipe bottom-left' },
  { value: 'wipebr', label: 'Wipe bottom-right' },
  { value: 'slideleft', label: 'Slide left' },
  { value: 'slideright', label: 'Slide right' },
  { value: 'slideup', label: 'Slide up' },
  { value: 'slidedown', label: 'Slide down' },
  { value: 'smoothleft', label: 'Smooth left' },
  { value: 'smoothright', label: 'Smooth right' },
  { value: 'smoothup', label: 'Smooth up' },
  { value: 'smoothdown', label: 'Smooth down' },
  { value: 'circlecrop', label: 'Circle crop' },
  { value: 'rectcrop', label: 'Rectangle crop' },
  { value: 'circleopen', label: 'Circle open' },
  { value: 'circleclose', label: 'Circle close' },
  { value: 'vertopen', label: 'Vertical open' },
  { value: 'vertclose', label: 'Vertical close' },
  { value: 'horzopen', label: 'Horizontal open' },
  { value: 'horzclose', label: 'Horizontal close' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'pixelize', label: 'Pixelize' },
  { value: 'diagtl', label: 'Diagonal top-left' },
  { value: 'diagtr', label: 'Diagonal top-right' },
  { value: 'diagbl', label: 'Diagonal bottom-left' },
  { value: 'diagbr', label: 'Diagonal bottom-right' },
  { value: 'hlslice', label: 'Horizontal left slice' },
  { value: 'hrslice', label: 'Horizontal right slice' },
  { value: 'vuslice', label: 'Vertical up slice' },
  { value: 'vdslice', label: 'Vertical down slice' },
  { value: 'hblur', label: 'Horizontal blur' },
  { value: 'hlwind', label: 'Wind left' },
  { value: 'hrwind', label: 'Wind right' },
  { value: 'vuwind', label: 'Wind up' },
  { value: 'vdwind', label: 'Wind down' },
  { value: 'squeezeh', label: 'Squeeze horizontal' },
  { value: 'squeezev', label: 'Squeeze vertical' },
  { value: 'zoomin', label: 'Zoom in transition' },
  { value: 'coverleft', label: 'Cover left' },
  { value: 'coverright', label: 'Cover right' },
  { value: 'coverup', label: 'Cover up' },
  { value: 'coverdown', label: 'Cover down' },
  { value: 'revealleft', label: 'Reveal left' },
  { value: 'revealright', label: 'Reveal right' },
  { value: 'revealup', label: 'Reveal up' },
  { value: 'revealdown', label: 'Reveal down' },
]

export interface User {
  id: string
  email: string
  is_verified: boolean
}

export interface Post {
  id: string
  caption: string
  media_path: string | null
  media_url: string | null
  media_type: MediaType | null
  reel_source_images: string[] | null
  reel_source_image_urls: string[] | null
  reel_target_seconds: number
  reel_audio_path: string | null
  reel_audio_url: string | null
  reel_audio_start_seconds: number
  reel_audio_end_seconds: number | null
  reel_voice_audio_path: string | null
  reel_voice_audio_url: string | null
  reel_voice_audio_start_seconds: number
  reel_voice_audio_end_seconds: number | null
  reel_transition: string
  reel_zoom_style: ReelZoomStyle
  reel_image_transitions: string[] | null
  reel_image_zoom_styles: ReelZoomStyle[] | null
  reel_image_durations: number[] | null
  reel_text_layers: ReelTextLayer[] | null
  reel_image_text_layers: ReelTextLayer[][] | null
  reel_image_color_filters: string[] | null
  reel_warning: string | null
  platform: Platform | null
  social_account_id: string | null
  social_account_name: string | null
  also_post_to_instagram: boolean
  scheduled_at: string | null
  status: PostStatus
  published_at: string | null
  error_message: string | null
  instagram_post_id: string | null
  instagram_error: string | null
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

export interface PaginatedPosts {
  items: Post[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export async function listPosts(page = 1, pageSize = 10): Promise<PaginatedPosts> {
  const res = await api.get<PaginatedPosts>('/posts', { params: { page, page_size: pageSize } })
  return res.data
}

export async function getPost(id: string): Promise<Post> {
  const res = await api.get<Post>(`/posts/${id}`)
  return res.data
}

export interface PostFormInput {
  caption: string
  scheduled_at?: string | null
  platform: Platform | ''
  social_account_id?: string | ''
  also_post_to_instagram?: boolean
  media?: File | null
  generate_reel?: boolean
  // Images and/or videos to build the reel from - may be empty (text-only).
  reel_images?: File[]
  use_ai_video?: boolean
  reel_target_seconds?: number
}

function toFormData(input: PostFormInput): FormData {
  const form = new FormData()
  form.append('caption', input.caption)
  if (input.scheduled_at) form.append('scheduled_at', input.scheduled_at)
  if (input.platform) form.append('platform', input.platform)
  if (input.social_account_id) form.append('social_account_id', input.social_account_id)
  form.append('also_post_to_instagram', String(input.also_post_to_instagram ?? false))
  if (input.generate_reel) {
    form.append('generate_reel', 'true')
    for (const file of input.reel_images ?? []) {
      form.append('reel_images', file)
    }
    form.append('use_ai_video', String(input.use_ai_video ?? false))
    if (input.reel_target_seconds) form.append('reel_target_seconds', String(input.reel_target_seconds))
  } else if (input.media) {
    form.append('media', input.media)
  }
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

export interface AiStatus {
  enabled: boolean
  video_model: string
  image_model: string
  video_clips: number
}

export async function getAiStatus(): Promise<AiStatus> {
  const res = await api.get<AiStatus>('/posts/ai-status')
  return res.data
}

// Reel segments can be video clips as well as images.
export function isVideoUrl(url: string | null | undefined): boolean {
  return /\.(mp4|mov|m4v|webm)$/i.test(url ?? '')
}

export async function deletePost(id: string): Promise<void> {
  await api.delete(`/posts/${id}`)
}

// Confirms a ready reel draft (generated video attached, previewed by the
// user) into the normal scheduled/publish pipeline.
export async function scheduleDraftPost(id: string, scheduledAtIso: string): Promise<Post> {
  const form = new FormData()
  form.append('scheduled_at', scheduledAtIso)
  const res = await api.post<Post>(`/posts/${id}/schedule`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export interface RegenerateReelInput {
  targetSeconds: number
  audio?: File | null
  audioStart?: number
  audioEnd?: number | null
  removeAudio?: boolean
  voiceAudio?: File | null
  voiceAudioStart?: number
  voiceAudioEnd?: number | null
  removeVoiceAudio?: boolean
  // New order for the reel's source images, as indices into the post's
  // current reel_source_images/reel_source_image_urls array. Omit to keep
  // the existing order.
  imageOrder?: number[]
  transition?: string
  zoomStyle?: ReelZoomStyle
  // Per-image overrides, indexed the same way as imageOrder (i.e. in the
  // *current pre-reorder* order, not by on-screen position) - one entry per
  // image. imageTransitions[i] is the transition leaving image i.
  imageTransitions?: string[]
  imageZoomStyles?: ReelZoomStyle[]
  // Per-image on-screen seconds, same indexing as imageOrder. When given,
  // the video's total length is whatever these sum to (minus overlaps)
  // instead of targetSeconds split evenly.
  imageDurations?: number[]
  // Burned-in text. textLayers show for the whole video;
  // imageTextLayers[i] only while image i is on screen (same indexing as
  // imageOrder). Send [] to clear all text.
  textLayers?: ReelTextLayer[]
  imageTextLayers?: ReelTextLayer[][]
  imageColorFilters?: string[]
}

// Re-renders a reel draft's video from its original source images (image
// order changed if given) with a new duration and/or custom audio track.
// Only ever called when the user clicks "Regenerate video" - picking a
// transition/zoom/duration in the UI only updates local preview state.
export async function regenerateReel(id: string, input: RegenerateReelInput): Promise<Post> {
  const form = new FormData()
  form.append('target_seconds', String(input.targetSeconds))
  form.append('audio_start', String(input.audioStart ?? 0))
  if (input.audioEnd != null) form.append('audio_end', String(input.audioEnd))
  if (input.removeAudio) form.append('remove_audio', 'true')
  if (input.audio) form.append('audio', input.audio)
  form.append('voice_audio_start', String(input.voiceAudioStart ?? 0))
  if (input.voiceAudioEnd != null) form.append('voice_audio_end', String(input.voiceAudioEnd))
  if (input.removeVoiceAudio) form.append('remove_voice_audio', 'true')
  if (input.voiceAudio) form.append('voice_audio', input.voiceAudio)
  if (input.imageOrder) form.append('image_order', input.imageOrder.join(','))
  if (input.transition) form.append('transition', input.transition)
  if (input.zoomStyle) form.append('zoom_style', input.zoomStyle)
  if (input.imageTransitions) form.append('image_transitions', input.imageTransitions.join(','))
  if (input.imageZoomStyles) form.append('image_zoom_styles', input.imageZoomStyles.join(','))
  if (input.imageDurations) form.append('image_durations', input.imageDurations.join(','))
  if (input.textLayers) form.append('text_layers', JSON.stringify(input.textLayers))
  if (input.imageTextLayers) form.append('image_text_layers', JSON.stringify(input.imageTextLayers))
  if (input.imageColorFilters) form.append('image_color_filters', input.imageColorFilters.join(','))
  const res = await api.post<Post>(`/posts/${id}/regenerate`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
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
  // In local dev, VITE_API_BASE_URL points at the separate backend (:8000).
  // In production, frontend and backend are served from the same origin, so
  // an empty base resolves to a same-origin relative URL with zero config.
  const base = import.meta.env.VITE_API_BASE_URL ?? ''
  return `${base}/api/social/facebook/connect`
}
