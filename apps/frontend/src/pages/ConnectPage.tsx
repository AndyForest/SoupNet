import { LegalPage } from "../components/LegalPage.js";
// Source of truth: docs/connectors/index.md. Vite's ?raw query inlines
// the file content as a string at build time. Editing the .md file is
// the only way to change the live page content.
import connectContent from "../../../../docs/connectors/index.md?raw";

export function ConnectPage() {
  return <LegalPage content={connectContent} />;
}
