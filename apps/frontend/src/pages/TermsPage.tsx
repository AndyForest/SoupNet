import { LegalPage } from "../components/LegalPage.js";
// Source of truth: docs/legal/terms-of-service.md (4 levels up from src/pages/).
// Vite's ?raw query inlines the file content as a string at build time.
// Editing the .md file is the only way to change the live page content.
import termsContent from "../../../../docs/legal/terms-of-service.md?raw";

export function TermsPage() {
  return (
    <LegalPage
      content={termsContent}
      pairLink={{ to: "/info/privacy", label: "Privacy Policy" }}
    />
  );
}
