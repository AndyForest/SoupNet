import { LegalPage } from "../components/LegalPage.js";
// Source of truth: docs/legal/privacy-policy.md (4 levels up from src/pages/).
// Vite's ?raw query inlines the file content as a string at build time.
// Editing the .md file is the only way to change the live page content.
import privacyContent from "../../../../docs/legal/privacy-policy.md?raw";

export function PrivacyPage() {
  return (
    <LegalPage
      content={privacyContent}
      pairLink={{ to: "/info/terms", label: "Terms of Service" }}
    />
  );
}
