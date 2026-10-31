# Package submission audit

Checked 2026-10-31 against [submission fields](https://developers.openai.com/plugins/deploy/submission) and [MCP authentication](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication).

| Fields in this package | Finding |
|---|---|
| Root schema, name, version, description | Portable Agent Plugins layout; schema URL and identity match the documented format; text fits limits. |
| author.name, author.email, author.url | Valid shapes and lengths. Publisher alignment awaits PR #171; do not upload the old Soup.net publisher under STEAMLabs. |
| homepage, repository, license, keywords | Supported optional metadata; HTTPS links, MIT identifier and string discovery terms. |
| extensions.com.openai.interface | Correct portable-format location. |
| displayName, shortDescription, longDescription | Within 30/30/4000 limits. Preserve approved copy and subtitle. |
| developerName, category, capabilities | Supported strings and string array; add the missing 80-character developer-name guard. Publisher alignment awaits #171. |
| websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL | Four HTTPS URLs present, within 1024 characters. Live publisher wording must match the selected identity before upload. |
| defaultPrompt | Three unique strings under 128 characters, without app mentions. |
| brandColor, brandColorDark | Valid hex colors; existing tests verify required contrast. |
| logo, composerIcon | Both refer to the included square 192-pixel PNG. Sharing one asset is valid; four separate icons are not required. |
| logoDark, composerIconDark, screenshots | Optional; remain omitted. |
| review.test_cases | Five positive and three negative cases; correct extension location. Positive tools_triggered must be a string, including comma-separated names for multiple tools. Fixed the manifest, validator and roster test; added an array-rejection regression test. |
| review.demo_recording_url | Optional in ZIP; required for MCP review. Leave omitted until an accessible recording exists; it can be entered in Review details. |
| publication.release_notes | Supported string in the correct location. |
| mcp.json schema, mcpServers.soupnet.type and url | Portable schema, streamable-http transport, public HTTPS endpoint. |
| server extensions.com.openai.auth | OAuth with DCR is supported. No credentials or nonempty headers ship. |
| skills/recipe-check/SKILL.md | Portable packages discover skills automatically. get-started is an example name, not a required folder. Existing name and description frontmatter present. No onboardingSkill is required. |

The local validator is a Soup.net package guard, not OpenAI's complete schema: it deliberately requires this package's OAuth/DCR setup, review-case counts, asset allowlist, and listing URLs even where upload allows omission. Successful local validation cannot certify the portal's semantic Metadata & Skills scans.

## Upload checkpoint

PR #171 was OPEN when checked. Merge that publisher PR and integrate origin/main before producing the upload-ready ZIP. Verify the deployed public legal pages identify STEAMLabs too.

Open Plugins, choose Upload new or existing plugin, select Business - STEAMLabs, then Upload plugin. For an existing draft, use Upload plugin to fix issues in Metadata & Skills. Wait for metadata and skill scans; use Copy issues for any remaining findings. Stop before MCPs > Connect until those checks are clean.

The recording and reviewer test account are later MCP-review prerequisites, not reasons to fabricate package fields. Keep reviewer credentials in Review details. The separate server session owns domain verification and tool-scan findings.
