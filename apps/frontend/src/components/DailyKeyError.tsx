import { Link } from "@tanstack/react-router";
import { isDailyKeySetupError, dailyKeySetupSentence } from "../lib/daily-key-error.js";

/**
 * Error line for any button that mints a daily key (POST /keys/daily). The
 * two scope-setup codes render as a sentence linking to the Recipe Books
 * page, where the include-in-daily-reads/writes toggles live; anything else
 * renders as the message it is. Renders nothing when there is no error.
 */
export function DailyKeyError({ error, style }: { error: string | null | undefined; style?: React.CSSProperties }) {
  if (!error) return null;
  const sentence = isDailyKeySetupError(error) ? dailyKeySetupSentence(error) : null;
  return (
    <p
      role="alert"
      className="text-xs"
      style={{ color: "var(--color-error, #b3261e)", marginTop: "var(--space-xs)", ...style }}
    >
      {sentence ? (
        <>
          {sentence.before}
          <Link to="/app/recipe-books" style={{ color: "inherit" }}>Recipe Books page</Link>
          {sentence.after}
        </>
      ) : (
        error
      )}
    </p>
  );
}
