/**
 * The recipe book page's heading (post-merge findings, 2026-09-29). The name
 * comes from the book itself, from the viewer's recipe books, because a book
 * whose recipes are all hidden from the viewer (a colleague's drafts, say)
 * has no first recipe to read it from. A recipe's book name is the fallback
 * for a viewer who is not a member (a system admin).
 */
export function bookRecipesHeading(
  bookId: string,
  books: ReadonlyArray<{ id: string; name: string }> | undefined,
  recipes: ReadonlyArray<{ groupName?: string | null }>,
): string {
  const name = books?.find((b) => b.id === bookId)?.name ?? recipes[0]?.groupName ?? null;
  return name ? `Recipes in ${name}` : "Recipes in this recipe book";
}
