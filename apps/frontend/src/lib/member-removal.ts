/**
 * Copy for the confirmation shown before an owner removes a member from a
 * recipe book (Recipe Books page, members list). Names the person and the
 * book so the owner can catch a click on the wrong row.
 */
export function memberRemovalPrompt(email: string, bookName: string): { question: string; detail: string } {
  return {
    question: `Remove ${email} from ${bookName}?`,
    detail: "They will lose access to this recipe book. You can invite them again later.",
  };
}
