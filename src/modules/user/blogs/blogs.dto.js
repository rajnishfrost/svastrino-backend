/**
 * Card shape for the listing grid — deliberately omits `body` so a page of 12
 * posts stays small.
 */
export function toBlogCardDTO(post) {
  return {
    slug: post.slug,
    title: post.title,
    owner: post.owner,
    author: post.author,
    categories: post.categories,
    excerpt: post.excerpt,
    coverImage: post.coverImage,
    publishedAt: post.publishedAt,
    readingMins: post.readingMins,
  }
}

/** Full shape for the article page (adds the markdown body + source link). */
export function toBlogDTO(post) {
  return {
    ...toBlogCardDTO(post),
    body: post.body,
    sourceUrl: post.sourceUrl,
    // Empty unless an admin has set one; the page then falls back to the
    // wording the old site published for this address.
    seoTitle: post.seoTitle || '',
    seoDescription: post.seoDescription || '',
    canonicalSlug: post.canonicalSlug || '',
  }
}
