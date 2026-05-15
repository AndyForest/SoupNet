import { LegalPage } from "../components/LegalPage.js";
// Source of truth: docs/connectors/claude.md. Vite's ?raw query inlines
// the file content as a string at build time. Editing the .md file is
// the only way to change the live page content.
import connectorContent from "../../../../docs/connectors/claude.md?raw";

export function ClaudeConnectorPage() {
  return <LegalPage content={connectorContent} />;
}
