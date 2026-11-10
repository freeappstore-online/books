// The books with a cover image, edition/covers/<id>.webp (served at /covers/), listed by scripts/catalog/covers.py
import COVER_IDS from '@edition/covers.json'

export const COVERS = new Set<string>(COVER_IDS)
