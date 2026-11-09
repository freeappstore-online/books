import { useNavigate } from 'react-router-dom'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { primeNarration } from '../hooks/narration'
import { fetchSavedOr } from '../hooks/offlineBooks'
import type { CatalogBook } from '../data/catalog'

/** Resume listening to a book where it stopped, and open it in the reader (books#13). */
export function ListenButton({ book, className }: { book: CatalogBook; className?: string }) {
  const player = useAudioPlayer()
  const navigate = useNavigate()

  const listen = async () => {
    // Synchronously, while this is still the user's click (iOS)
    primeNarration()
    try {
      const res = await fetchSavedOr(book.contentPath)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json() as { chapters: { title: string; content: string }[] }
      const chapters = data.chapters.map((ch, i) => ({ id: `ch-${i}`, title: ch.title, content: ch.content }))
      player.loadAndPlay({ slug: book.id, title: book.title, author: book.author, chapters })
    } catch { /* Opens the reader anyway, which explains what is missing */ }
    navigate(`/read/${book.id}`)
  }

  return (
    <button onClick={listen} className={className}>
      Listen
    </button>
  )
}
