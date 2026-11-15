// Shared with auth setup without importing provider factories or chat stores.
export const OFFICIAL_CHAT_PROVIDER_ID = 'official-provider'
export const OFFICIAL_SPEECH_PROVIDER_ID = 'official-provider-speech'
export const OFFICIAL_SPEECH_STREAMING_PROVIDER_ID = 'official-provider-speech-streaming'
export const OFFICIAL_TRANSCRIPTION_PROVIDER_ID = 'official-provider-transcription'
export const OFFICIAL_VISION_PROVIDER_ID = 'vision-official-provider'
// Dahlia: here rather than in ./shared, which imports the chat session store. A store that imports the provider
// list loaded ./index while ./shared was still loading, and ./index read the icon before ./shared defined it.
export const OFFICIAL_ICON = 'i-solar:star-bold-duotone'
