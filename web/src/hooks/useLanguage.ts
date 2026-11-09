/**
 * Language preferences for the app UI and TTS.
 * Stored in localStorage. Browser TTS uses the system voices for the selected language.
 */

const KEY = 'bp-language'

export interface Language {
  code: string
  name: string
  nativeName: string
  /** BCP 47 tag for SpeechSynthesis */
  ttsCode: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', ttsCode: 'en-US' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', ttsCode: 'zh-CN' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', ttsCode: 'ru-RU' },
  { code: 'fr', name: 'French', nativeName: 'Français', ttsCode: 'fr-FR' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', ttsCode: 'es-ES' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', ttsCode: 'ja-JP' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', ttsCode: 'hi-IN' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', ttsCode: 'pt-BR' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', ttsCode: 'it-IT' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', ttsCode: 'de-DE' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', ttsCode: 'ko-KR' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', ttsCode: 'ar-SA' },
]

export function getLanguage(): string {
  try { return localStorage.getItem(KEY) || 'en' } catch { return 'en' }
}

export function setLanguage(code: string) {
  try { localStorage.setItem(KEY, code) } catch {}
}

export function getLanguageByCode(code: string): Language {
  return LANGUAGES.find(l => l.code === code) || LANGUAGES[0]
}

export function getTtsCode(): string {
  return getLanguageByCode(getLanguage()).ttsCode
}
