import type { CatalogBook } from '../data/catalog'

interface Props {
  book: CatalogBook
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { w: 'w-28', h: 'h-40', title: 'text-xs', author: 'text-[10px]' },
  md: { w: 'w-36', h: 'h-52', title: 'text-sm', author: 'text-xs' },
  lg: { w: 'w-48', h: 'h-68', title: 'text-base', author: 'text-sm' },
}

export function BookCover({ book, size = 'md' }: Props) {
  const s = sizes[size]
  return (
    <div className={`${s.w} ${s.h} rounded-lg bg-gradient-to-br ${book.coverGradient} relative overflow-hidden flex flex-col justify-end p-3 shadow-lg group-hover:shadow-xl transition-shadow`}>
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 20px, ${book.coverAccent}22 20px, ${book.coverAccent}22 21px)`,
      }} />
      <div className="relative z-10">
        <h3 className={`${s.title} font-display leading-tight text-white mb-1`}>{book.title}</h3>
        <p className={`${s.author} text-white/60`}>{book.author}</p>
      </div>
      <div className="absolute top-2 right-2 w-6 h-6 rounded-full opacity-20" style={{ background: book.coverAccent }} />
    </div>
  )
}
