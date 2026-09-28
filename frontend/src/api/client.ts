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

// Mirrors backend/app/services/reel_text.py. (x, y) is the centre of the
// text block as a 0-1 fraction of the frame - set by dragging it in the
// live preview; font_size is in px on a 1080px-wide frame.
export interface ReelTextLayer {
  text: string
  font: string
  font_size: number
  color: string
  x: number
  y: number
  background: boolean
}

export const REEL_MIN_FONT_SIZE = 16
export const REEL_MAX_FONT_SIZE = 160
export const REEL_MAX_TEXT_LAYERS = 30

export const DEFAULT_TEXT_LAYER: ReelTextLayer = {
  text: '',
  font: 'poppins',
  font_size: 56,
  color: '#FFFFFF',
  x: 0.5,
  y: 0.5,
  background: true,
}

// Layers saved before drag-to-position had a `position` preset instead of
// x/y - same mapping as reel_text.py's _LEGACY_POSITIONS.
const LEGACY_X: Record<string, number> = { left: 0.3, center: 0.5, right: 0.7 }
const LEGACY_Y: Record<string, number> = { top: 0.08, middle: 0.5, bottom: 0.88 }

export function normalizeTextLayer(raw: Partial<ReelTextLayer> & { position?: string }): ReelTextLayer {
  const [vertical, horizontal] = (raw.position ?? 'bottom_center').split('_')
  return {
    ...DEFAULT_TEXT_LAYER,
    ...raw,
    x: raw.x ?? LEGACY_X[horizontal] ?? 0.5,
    y: raw.y ?? LEGACY_Y[vertical] ?? 0.88,
    font: raw.font ?? DEFAULT_TEXT_LAYER.font,
    background: raw.background ?? true,
  } as ReelTextLayer
}

// Mirrors backend/app/services/reel_text.py's CTAs: an animated button
// that pops up on clip `clip` (an index into the post's clips), `offset`
// seconds into it, for `duration` seconds - it can run on over later clips.
export type ReelCtaAnimation = 'pop' | 'slide_up' | 'fade' | 'pulse'

export interface ReelCta {
  text: string
  link: string | null
  clip: number
  offset: number
  duration: number
  x: number
  y: number
  font: string
  font_size: number
  text_color: string
  bg_color: string
  animation: ReelCtaAnimation
}

export const REEL_CTA_ANIMATIONS: { value: ReelCtaAnimation; label: string }[] = [
  { value: 'pop', label: 'Pop in' },
  { value: 'pulse', label: 'Pop in + pulse' },
  { value: 'slide_up', label: 'Slide up' },
  { value: 'fade', label: 'Fade in' },
]

export const REEL_MAX_CTAS = 10

export const DEFAULT_CTA: ReelCta = {
  text: 'Shop now',
  link: null,
  clip: 0,
  offset: 1,
  duration: 4,
  x: 0.5,
  y: 0.8,
  font: 'poppins',
  font_size: 56,
  text_color: '#FFFFFF',
  bg_color: '#F97316',
  animation: 'pop',
}

export interface ReelFont {
  id: string
  name: string
  url: string
}

export async function listReelFonts(): Promise<ReelFont[]> {
  const res = await api.get<ReelFont[]>('/posts/reel-fonts')
  return res.data
}

export const REEL_COLOR_FILTERS: { value: string; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'muted', label: 'Muted' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'bw', label: 'Black & white' },
]

export type ReelZoomStyle = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'none'
export const REEL_ZOOM_STYLES: { value: ReelZoomStyle; label: string }[] = [
  { value: 'zoom_in', label: 'Zoom in' },
  { value: 'zoom_out', label: 'Zoom out' },
  { value: 'pan_left', label: 'Pan left' },
  { value: 'pan_right', label: 'Pan right' },
  { value: 'none', label: 'No motion' },
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
  reel_template: string | null
  // Per-clip template overrides (same order as reel_source_images).
  reel_clip_templates: (string | null)[] | null
  reel_brand_color: string
  reel_title_text: string | null
  reel_logo_url: string | null
  reel_logo_x: number
  reel_logo_y: number
  reel_logo_scale: number
  reel_ctas: ReelCta[] | null
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
  reel_template?: string | null
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
    if (input.reel_template) form.append('reel_template', input.reel_template)
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
  // Template id, or '' for none. Brand fields: '' clears.
  template?: string
  brandColor?: string
  titleText?: string
  logo?: File | null
  removeLogo?: boolean
  logoX?: number
  logoY?: number
  logoScale?: number
  // Clip indices in the current (pre-reorder) order, like imageOrder.
  ctas?: ReelCta[]
  // Clips to add - they take indices n, n+1, ... after the post's current
  // n clips, in every per-image field and in imageOrder. A clip (old or
  // new) left out of imageOrder is removed from the reel.
  newClips?: File[]
  // Per-clip template ids, same indexing as imageOrder; '' = reel's template.
  clipTemplates?: string[]
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
  if (input.template !== undefined) form.append('template', input.template)
  if (input.brandColor !== undefined) form.append('brand_color', input.brandColor)
  if (input.titleText !== undefined) form.append('title_text', input.titleText)
  if (input.logo) form.append('logo', input.logo)
  if (input.removeLogo) form.append('remove_logo', 'true')
  if (input.logoX !== undefined) form.append('logo_x', String(input.logoX))
  if (input.logoY !== undefined) form.append('logo_y', String(input.logoY))
  if (input.logoScale !== undefined) form.append('logo_scale', String(input.logoScale))
  if (input.ctas) form.append('ctas', JSON.stringify(input.ctas))
  for (const clip of input.newClips ?? []) form.append('new_clips', clip)
  if (input.clipTemplates) form.append('clip_templates', input.clipTemplates.map((t) => t || 'none').join(','))
  const res = await api.post<Post>(`/posts/${id}/regenerate`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

// Mirrors backend/app/services/reel_templates.py - the live preview draws
// each template's graphics from these same fields.
export interface ReelTemplate {
  id: string
  name: string
  description: string
  transition: string
  transitions?: string[]
  zoom_style: ReelZoomStyle
  color_filter: string
  hook_seconds?: number
  hook_style?: 'bold' | 'elegant'
  letterbox?: boolean
  frame?: boolean
  // Rhythm templates: these cycle across clips by on-screen position, and
  // videos get cut to the `durations` pattern when `cut_videos` is set.
  zoom_styles?: ReelZoomStyle[]
  durations?: number[]
  cut_videos?: boolean
  // Transition length in seconds (default 1).
  xfade?: number
  intro_card?: boolean
  outro_card?: boolean
}

// Mirrors reel_templates.py's slot_settings: what a template gives the clip
// at on-screen position `pos`.
export function templateSlot(template: ReelTemplate, pos: number) {
  const pick = <T,>(values: T[] | undefined, fallback: T) => (values?.length ? values[pos % values.length] : fallback)
  return {
    transition: pick(template.transitions, template.transition),
    zoomStyle: pick(template.zoom_styles, template.zoom_style),
    duration: template.durations?.length ? template.durations[pos % template.durations.length] : null,
  }
}

export async function listReelTemplates(): Promise<ReelTemplate[]> {
  const res = await api.get<ReelTemplate[]>('/posts/reel-templates')
  return res.data
}

export interface AIEditResult {
  post: Post
  reply: string
  // Setting names the AI changed - empty means nothing was re-rendered.
  changed: string[]
}

export async function aiEditReel(id: string, instruction: string): Promise<AIEditResult> {
  const form = new FormData()
  form.append('instruction', instruction)
  const res = await api.post<AIEditResult>(`/posts/${id}/ai-edit`, form, {
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
