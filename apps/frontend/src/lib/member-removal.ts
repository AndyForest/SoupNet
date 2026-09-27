/**
 * Copy for the confirmation shown before an owner removes a member from a
 * recipe book (Recipe Books page, members list). Names the person and the
 * book so the owner can catch a click on the wrong row. The confirm button
 * reads differently from the row's "Remove" (as account deletion's confirm
 * step does), and its accessible name adds the person's email after the
 * visible text.
 */
export function memberRemovalPrompt(
  email: string,
  bookName: string,
): { question: string; detail: string; confirmLabel: string; confirmAccessibleName: string } {
  const confirmLabel = "Yes, remove";
  return {
    question: `Remove ${email} from ${bookName}?`,
    detail: "They will lose access to this recipe book. You can invite them again later.",
    confirmLabel,
    confirmAccessibleName: `${confirmLabel} ${email}`,
  };
}
