import {
  MEETING_PROVIDERS,
  SUPPORTED_MEETING_PROVIDERS,
  type MeetingProvider,
} from '../../config/constants.js'
import { googleMeetProvider } from './google-meet.provider.js'
import type { MeetingProviderAdapter } from './meeting-provider.js'

const adapters: Partial<Record<MeetingProvider, MeetingProviderAdapter>> = {
  [MEETING_PROVIDERS.GOOGLE_MEET]: googleMeetProvider,
}

export function getMeetingProvider(provider: MeetingProvider): MeetingProviderAdapter {
  const adapter = adapters[provider]
  if (!adapter) {
    throw new Error(`No meeting adapter is registered for ${provider}.`)
  }
  return adapter
}

export function isSupportedMeetingProvider(provider: MeetingProvider): boolean {
  return (SUPPORTED_MEETING_PROVIDERS as readonly MeetingProvider[]).includes(provider)
}

export type {
  CancelMeetingInput,
  CreateMeetingInput,
  MeetingDetails,
  MeetingProviderAdapter,
  UpdateMeetingInput,
} from './meeting-provider.js'
