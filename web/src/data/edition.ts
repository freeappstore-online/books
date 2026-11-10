// This app's edition: its identity, language and narration (edition/config.json, docs/editions.md)
import CONFIG from '@edition/config.json'

export interface EditionConfig {
  /** App id: its subdomain and repository name */
  id: string
  name: string
  shortName: string
  /** BCP 47 language of the interface and the books */
  language: string
  /** Where the app is served, without a trailing slash */
  site: string
  /** The companion FreeWebStore catalogue */
  marketingSite: string
  title: string
  description: string
  /** og:/twitter: description */
  shareDescription: string
  audio: {
    /** Hugging Face dataset holding the narration */
    dataset: string
    /** Narrator voice id: the manifest key and folder in the dataset */
    voice: string
    engine: string
  }
}

export const EDITION: EditionConfig = CONFIG
