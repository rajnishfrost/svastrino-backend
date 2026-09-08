/**
 * The arithmetic behind every paginated admin table, in one place.
 *
 * The admin lists used to answer with a hard cap instead — `.limit(200)` on
 * users, `.limit(500)` on orders and the rest. A cap is not a small version of
 * pagination; it is a silent one. Nothing on the page said "200 of 340", so the
 * 201st account simply was not there, and nobody looking at the screen had any
 * way to know. Returning `total` alongside the rows is half the point of this.
 *
 * ROWS_PER_PAGE is the whole admin panel's answer, not each table's — a panel
 * where one list pages at 10 and the next at 20 makes a reader re-learn the
 * furniture on every screen.
 *
 * Services keep building their own query — each has its own sort, projection
 * and populate, and hiding those behind a generic finder would cost more than
 * the six lines it saved. What is shared is the part that must not vary: how a
 * page number becomes a skip, what the ceiling on a page size is, and the shape
 * of the answer the client reads.
 */

/** How many rows every admin table shows at once. */
export const ROWS_PER_PAGE = 10

/** Clamp whatever arrived in the query string into a page/limit/skip. */
export function pageOf({ page, limit } = {}, { defaultLimit = ROWS_PER_PAGE, maxLimit = 100 } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  // Capped on purpose: `?limit=100000` is otherwise a way for anyone with a
  // panel login to ask the database for everything at once.
  const safeLimit = Math.min(maxLimit, Math.max(1, Number(limit) || defaultLimit))
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit }
}

/**
 * The response shape every paginated list returns. `pages` is at least 1 so an
 * empty table still reads as "page 1 of 1" rather than "page 1 of 0".
 */
export function pageResult(items, total, { page, limit }) {
  return { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
}
