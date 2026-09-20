# Domain verification, claiming existing accounts, and admin-visibility transparency

Status: research input for the [organization accounts program](../org-accounts-program.md) §3.2, §3.3, §3.6, §3.10. Nothing here is ratified. All sources accessed 2026-09-19. Page dates are given where the page shows one.

Quoting convention: quotes are verbatim from the linked page. The only normalization is whitespace (line breaks and the stray spaces that appear around inline links when a web page is reduced to text). Quotes are contiguous excerpts. The few places where words are omitted inside a quote are marked "[...]".

---

## 1. Question

The program needs a company to prove it owns an email domain before its employees auto-join an organization and before it can claim accounts that already exist on that domain. The operator asked seven things:

1. Which domain verification methods do major vendors offer, which is the default, which are weaker, and is anything more standard or better than DNS TXT?
2. Do vendors re-verify, what happens when the record disappears or the domain lapses, and how long does an unverified challenge live?
3. What are the rules for one domain per org, subdomains, and public email-provider domains?
4. How do vendors let a verified org claim accounts that already exist on its domain: what notice, what choices, what deadlines, and what happens to the person's existing content?
5. How do vendors describe auto-join by email domain, and what do they require of the joining user?
6. What do vendors tell END USERS about what admins can see, including takeover and transfer at offboarding?
7. Who owns content created by a managed account, in the vendors' own terms?

---

## 2. Findings

### 2.1 Verification methods

**The closest thing to a standard is an IETF Best Current Practice draft, and it recommends DNS TXT on a dedicated underscore label.** The draft is [Domain Control Validation using DNS, draft-ietf-dnsop-domain-verification-techniques-13](https://datatracker.ietf.org/doc/html/draft-ietf-dnsop-domain-verification-techniques) (published 22 June 2026, intended status Best Current Practice, still an Internet-Draft, which by its own boilerplate is "work in progress").

- On the method: "The RECOMMENDED method of doing DNS-based domain control validation is to use DNS TXT records as the Validation Record."
- On where the record goes: "The RECOMMENDED format for a Validation Record's owner name is application-specific underscore prefix labels. Domain Control Validation Records are constructed by the Application Service Provider by prepending the label "_<PROVIDER_RELEVANT_NAME>-challenge" to the domain name being validated (e.g., "_example_service-challenge.example.com")."
- On the apex habit most vendors still have: "A very common but unfortunate technique in use today is to employ a DNS TXT record and place it at the exact domain name whose control is being validated (e.g., often the zone apex). This has a number of known operational issues."
- Why the apex is a problem: "Since DNS resource record sets are treated atomically, a query for the Validation Record will return all TXT records in the response. There is no way for the verifier to specifically query only the TXT record that is pertinent to their application service."
- A security reason for a vendor-named label (§9.3 Service Confusion): "For example, by requiring a DNS TXT record at _vendorname.example.com instead of at example.com, a malicious service could no longer forward a challenge from a different service without the User noticing."
- A delegation reason: "When multiple distinct services specify placing Validation Records at the same owner name, there is no way to delegate an application specific domain Validation Record to a third party."
- The draft scopes itself to DNS: "it can be done using a variety of methods such as email, HTTP/HTTPS, or the DNS itself. This document focuses only on DNS-based methods".

**What each vendor offers.**

| Vendor | Methods offered | Record location | Source |
|---|---|---|---|
| Google Workspace | TXT (the documented path); the transfer tool additionally requires "a TXT or CNAME record" | Apex: "Name / Host / Alias Leave this blank, or enter @" | [Verify your domain for Google Workspace](https://knowledge.workspace.google.com/admin/domains/verify-your-domain-for-google-workspace), [Verify your domain with a TXT record](https://knowledge.workspace.google.com/admin/domains/verify-your-domain-with-a-txt-record), [Before using the transfer tool](https://knowledge.workspace.google.com/admin/users/before-using-the-transfer-tool) |
| Atlassian | "HTTPS", "DNS TXT", and Google Workspace or Microsoft Entra ID | Apex: "Name / Host / Alias : Leave the default (@ or blank)" | [Verify a domain to manage accounts](https://support.atlassian.com/user-management/docs/verify-a-domain-to-manage-accounts/) |
| GitHub organizations | DNS TXT only: "Follow the instructions under "Add a DNS TXT record" to create a DNS TXT record with your domain hosting service." | Dedicated label. The org page does not print the label; the sibling Pages flow shows the pattern: `dig _github-pages-challenge-ORGANIZATION.example.com +nostats +nocomments +nocmd TXT` | [Verifying or approving a domain for your organization](https://docs.github.com/en/organizations/managing-organization-settings/verifying-or-approving-a-domain-for-your-organization), [Verifying your custom domain for GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages) |
| Slack | DNS TXT only | Mixed: "create a DNS TXT record (for Host, use @ if the domain is not a wildcard and _slack-challenge if it is)" | [Claim and verify email domains](https://slack.com/help/articles/5513043606547-Claim-and-verify-email-domains) |
| Notion | DNS record: "Enter your email domain and select Get verification code. Follow the prompts to update your DNS record." | Not stated on the page | [Domain management in Notion](https://www.notion.com/help/domain-management) |
| Figma | DNS TXT only: "verify them by adding a unique code as a TXT record to the DNS records managed by your domain provider" | Not stated on the page | [Manage domain capture for an organization](https://help.figma.com/hc/en-us/articles/360045953273-Manage-domain-capture-for-an-organization) |
| Microsoft Entra | TXT or MX: "Creating this TXT or MX record for your domain verifies ownership of your domain name." | Not quoted here | [Add your custom domain](https://learn.microsoft.com/en-us/entra/fundamentals/add-custom-domain) |
| Dropbox | "Add a meta tag", "Upload an HTML file", "Create a TXT record" | Not stated on the page | [Domain verification and invite enforcement](https://help.dropbox.com/account-access/domain-verification-invite-enforcement) |

Observations that the quotes support:

- Every vendor in the sample offers DNS TXT. Four of eight (GitHub, Slack, Notion, Figma) document nothing else.
- None of the eight documents an email-to-`admin@` method for domain ownership.
- Vendors that offer a web-server method do not call it weak. Dropbox says of the meta tag and HTML file: "This is a secure and relatively fast option, since Dropbox will be able to see the changes as soon as they are live on your website." Atlassian treats HTTPS as a peer of DNS and recommends holding both: "You should use more than one method to verify you own your company's domain."
- The documented difference is scope, not strength. Google Search Console says the DNS method is "More complex, but is the only way to verify a Domain property" and that "Domain properties are useful because they include data for all protocol (http/https) and subdomain variations of your property." ([Verify your site ownership](https://support.google.com/webmasters/answer/9008080?hl=en)). A file on a web server proves control of that host; a DNS record proves control of the zone that also routes the domain's email.
- A federated shortcut exists at Atlassian (verify through Google Workspace or Entra), which relies on the identity provider having already verified the domain.
- GitHub has a second, weaker state that needs no proof at all, for notification routing only: "The ability to approve a domain not owned by your organization or enterprise is currently in public preview and subject to change."

### 2.2 Re-verification, record removal, lapse, and token expiry

Vendors split into persistent validation (the record must stay) and one-off validation (the record can go).

- **Atlassian, persistent, with a defined grace period.** "After verification is successful, we'll periodically check your DNS host for the txt record. If someone deletes or updates the txt record with incorrect information, we'll send you an email letting you know that you have a certain amount of time to update the txt record. If you don't, your domain will lose its verification status and any security policies for that domain, including SAML single sign-on, won't be effective." The status table gives the number: "If you don't verify your domain within 14 days, your domain verification status will change to Unverified and any managed accounts with this domain will become unclaimed." Unclaiming is not destructive: "When you unclaim accounts, you no longer manage the accounts and we remove the accounts from your authentication policies. Even though these accounts are no longer managed, users still keep their app access." ([source](https://support.atlassian.com/user-management/docs/verify-a-domain-to-manage-accounts/))
- **Atlassian uses record removal as the release mechanism between orgs.** "If you control the DNS records for the domain, you can remove the Atlassian verification token from your DNS. After the token is removed, the claim will be released automatically after 30 days." (same page)
- **Google Search Console, persistent.** "Search Console periodically checks if your verification token is still present and valid. If verification can no longer be confirmed, you will be notified. If the issue is not fixed, your permissions on that property will expire after a certain grace period." and "Important: To stay verified, don't remove the DNS record from your provider, even after verification succeeds." ([source](https://support.google.com/webmasters/answer/9008080?hl=en))
- **GitHub Pages, persistent.** "To make sure your custom domain remains verified, keep the TXT record in your domain's DNS configuration." ([source](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages))
- **GitHub organizations, one-off.** "Optionally, once the "Verified" badge is visible on your organization's profile page, you can delete the TXT entry from the DNS record at your domain hosting service." ([source](https://docs.github.com/en/organizations/managing-organization-settings/verifying-or-approving-a-domain-for-your-organization))
- **Linear puts the lapse risk on the customer.** "Please review this list regularly to ensure it is up to date. If you ever cancel your domain or transfer control of a domain to another organization, you'll need to remove this domain from your approved email domains in Linear to prevent unwanted access to the workspace." ([Invite members](https://linear.app/docs/invite-members))
- **Challenge expiry, Notion.** "You must verify a domain within one week of adding the domain. After a week, the verification code will expire and you'll have to repeat the steps above." ([source](https://www.notion.com/help/domain-management))
- **Google Workspace ties verification to account survival.** "You must verify your domain within the first 9 days of your free trial period, or when starting a paid contract. If you don't verify your domain, your account will be automatically deleted within 21 days of signup." ([source](https://knowledge.workspace.google.com/admin/domains/verify-your-domain-for-google-workspace))
- **DNS propagation window that vendors tell admins to expect.** GitHub: "Wait for your DNS configuration to change, which may take up to 72 hours." Notion: "Typically, a change in the DNS record takes only minutes to propagate; however, there are cases where it may take up to 72 hours."

What the IETF draft requires of a provider that chooses persistent validation:

- "For persistent validations, Application Service Providers MUST provide clear instructions for how to perform revocations through the removal of a Validation Record, including details on the frequency at which re-validation is performed."
- "Application Service Providers MUST provide clear instructions on how long the challenge token is valid for, and thus when a Validation Record can be removed."
- On a domain changing hands (§9.11): "When a domain has a new owner, that new owner could add a Validation Record that was present in the previous version of the domain. In the case of persistent validation this could be used to claim that the original User still has access to the domain within the Application Service Provider's service."
- On re-validation by someone new (§9.13): "Application Service Providers need to take care that re-validation of a domain by a different User is not necessarily treated as "reactivation" in a way that grants access to potentially sensitive resources stored and associated with a domain."

### 2.3 One domain per org, subdomains, public domains

- **One org per domain.** Notion: "An email domain can belong to only one Notion organization. Two organizations can't share it." Microsoft Entra: "A domain name can only be verified in one directory. If your domain name is currently verified in another directory, it can't also be verified in the new directory." Atlassian is softer: "If someone else has already verified the domain when trying to set a claim setting, we'll display a warning message letting you know." and "We can only claim accounts that are available to claim. An account is available when another organization hasn't claimed them yet."
- **Subdomains do not inherit, in most products.** Notion: "A domain does not cover its subdomains." Atlassian: "Because we don't automatically verify sub domains, such as us.acme.com and eu.acme.com, you need to manually verify each subdomain as well." Figma: "verifying example.com won't capture people with brand.example.com email addresses."
- **Two exceptions show inheritance as an explicit choice.** Dropbox: "When you verify a primary domain, you'll see a checkbox next to Include all subdomains. Leave this checked to verify all subdomains of the primary domain." Google Search Console: "Verifying ownership of a root domain automatically verifies ownership of all subdomains, but verifying ownership of a subdomain does not verify ownership of a parent domain."
- **The IETF draft says scope must be explicit.** "Both Application Service Providers and the User need to clearly specify and understand whether the validation request is for a single hostname, a wildcard (all hostnames immediately under that domain), or for the entire domain and subdomains rooted at that name."
- **Public email domains.** Atlassian: "You can't verify ownership of a public domain, such as gmail.com." The IETF draft covers the adjacent case of public suffixes: "Application Service Providers SHOULD NOT allow verification of ownership for domains which are public suffixes in the "ICANN" division."
- **Notion excludes one more class from claiming.** "Your verified domain must not be an educational domain."

### 2.4 Claiming accounts that already exist on the domain

Four distinct designs exist. They differ most on whether the person gets a choice.

**Atlassian: the admin claims unilaterally, the person is told afterwards.**

- What a claim is: "A managed account is an Atlassian account your organization has full administrative control of. To manage an Atlassian account, you have to verify the email domain to prove you own it and claim the account. Once claimed, you can update their account details and deactivate or delete their account if needed." ([What are managed accounts?](https://support.atlassian.com/user-management/docs/what-are-managed-accounts/))
- Verification and claiming are separate steps: "Once you have verified your domain, your domain will be in a verified state but you will not have claimed your user accounts."
- Admins are warned about surprises: "When you claim accounts, you may see more users than you expect already have Atlassian accounts. You may even see accounts in your organization for users who don't use your company's Atlassian apps. This is because anyone can create an Atlassian account." They can review first: "To review individual accounts and the apps they access, export a CSV file of the domain's accounts."
- All or some: "When you choose to claim all accounts, we automatically claim accounts from a verified domain. When you choose some accounts, you decide when to manually claim some accounts from a verified domain."
- The notice: "When you claim or unclaim accounts, we let those users know that your organization manages or no longer manages their accounts with an in-app notification. We also tell them in their account settings."
- The page describes no accept, decline, or deadline for the person. What the person reads afterwards: "If an organization manages your account, this means they have full administrative control of your account. An admin can manage your account details, require security measures, and delete your account, if necessary. If you need to change your account details, you'll need to contact an admin to do so." ([What is an Atlassian account?](https://support.atlassian.com/atlassian-account/docs/what-is-an-atlassian-account/))
- A guard worth copying: "If a managed account hasn't verified their email address, you're unable to make changes to their account."

**Google: the person is invited to transfer, cannot decline, and keeps their data if they do nothing.** Pages last updated 2026-09-18 UTC.

- Definitions: "An unmanaged personal account is fully owned and managed by the individual who created it." and "A managed user account is under the full control of a Google Workspace or Cloud Identity administrator". ([Transfer unmanaged personal accounts](https://knowledge.workspace.google.com/admin/users/transfer-unmanaged-personal-accounts))
- Three admin policies: "You can invite unmanaged users to convert their accounts to managed accounts within your domain, unilaterally replace conflicting accounts with managed ones, or manually manage conflicting accounts."
- The notice: "Users get an email when you send them a transfer request. In the email, they can click Transfer my account." and "The user must agree to certain terms to start the transfer." ([Use the transfer tool](https://knowledge.workspace.google.com/admin/users/use-the-transfer-tool-to-migrate-unmanaged-personal-accounts))
- Follow-up and deadline are admin-configured: "Set a daily follow-up email duration. We will send a daily email to the user for the specified time period asking whether they want to accept the request to transfer their account to a managed state. If they agree, the entire account is transferred to a managed state, including any data associated with the account".
- The choice is accept or ignore: "Can a user decline a request? No, a user cannot decline a request; however the user can ignore it."
- What ignoring leads to: "You can create an account in your organization's managed Google account with the same email address as the user. After you create their managed Google Account, they're prompted to rename their personal account the next time they sign in."
- The rename is the person's own act: "Users have full control over renaming their personal accounts—administrators don't participate in this process."
- Content if they accept: "If the user accepts the transfer request, you can: Manage the account. [...] Access and delete data in the account. Restrict access to Google services."
- Content if they rename: "When a user renames their personal account, the data in their personal account: Stays in their personal account. Is safe and accessible only to them."
- Conversion is one-way, and the docs tell people to export first: transferred accounts "Can't be changed back to a personal account." and "Transferred unmanaged personal accounts may lose data and content for some Google services. Your users might want to review and download their personal account info before transferring their account." ([Before using the transfer tool](https://knowledge.workspace.google.com/admin/users/before-using-the-transfer-tool))
- Google's stated reason for the whole mechanism: "You can't control the life cycle of an unmanaged personal account. An employee who leaves the company might continue to use the unmanaged personal account to access corporate resources or to generate corporate expenses."

**Dropbox: a forced two-way choice.** Pages updated Jul 02, 2025.

- The choice: "Invite enforcement will require all invited users with a personal Dropbox account created using an email on the verified domain to select from one of two options: Join the team with their existing account. If their account has mostly personal content, they can change the email address associated with this account to a new personal email address. This will keep their existing content separate from the team account." ([source](https://help.dropbox.com/account-access/domain-verification-invite-enforcement))
- The Enterprise version applies to everyone on the domain: "Admins can then use account capture to force these users to migrate that personal account to the Enterprise team or to change the email address associated with their personal Dropbox account." ([Domain insights and account capture](https://help.dropbox.com/account-access/domain-insights-account-capture))
- Advance notice is optional and admin-authored: "If you choose All users, you have the option to email Dropbox users on your domain before account capture [...] You can Skip this step. If you choose to send the email, enter an email address that users can respond to if they have questions about this notification."
- Information is withheld until the domain is proven: "Dropbox won't provide any user information or enable invite enforcement until you successfully verify domain ownership."
- Before capture, admins see a count, not a list: "Each of your owned domains will show the amount of personal Dropbox account activity under the Personal accounts column."

**Notion: a waiting period, then workspace-level claim or a personal-email exit.**

- Eligibility includes a delay: "Your verified domain must have been verified for at least 14 days."
- The notice: "Once an organization owner verifies a domain, an automated email will be sent to all workspace owners of workspaces that already exist with that domain, notifying them that their workspaces are eligible to be claimed. During this 14-day notification period, workspace owners can only request ownership transfers on single-member workspaces. They will be unable to delete single-member workspaces or claim multi-member workspaces."
- The personal exit is explicitly designed for: "organization owners on the Enterprise Plan can request a change in ownership transfer on single-member workspaces using a verified domain to a non-corporate email address. This is especially helpful when users created a workspace using a corporate email address, but use the workspace primarily for personal projects."
- The exit is forceful once requested: "an email notification will be sent to the workspace owner of the selected workspace and the user will not be able to access their workspace until they have completed the remaining transfer steps".
- After the window the org may delete: "when an employee leaves a company, Enterprise organization owners can delete their single member workspaces to clean up old content while remaining compliant."
- All from [Domain management in Notion](https://www.notion.com/help/domain-management).

**Microsoft Entra: takeover of a whole unmanaged tenant by DNS proof.** "When a self-service user signs up for a cloud service that uses Microsoft Entra ID, they're added to an unmanaged Microsoft Entra directory based on their email domain." and "When you verify ownership of the domain name, Microsoft Entra ID removes the domain name from the unmanaged organization and moves it to your existing organization." ([Take over an unmanaged directory](https://learn.microsoft.com/en-us/entra/identity/users/domains-admin-takeover)). The page describes no notice to the affected users.

### 2.5 Auto-join by email domain

- **Notion: an offer during onboarding, accepted by the user.** "Now, whenever someone signs into Notion with an email that has one of those domains, they'll see the option to join your workspace during onboarding. If the user joins your workspace, they will become a member of your workspace and you will be billed accordingly." The plain setting does not need DNS proof, but is bounded: "You can add multiple allowed domains in this field, but you'll only be able to add domains that workspace members' accounts are under." ([Manage members, admins & guests](https://www.notion.com/help/add-members-admins-guests-and-groups))
- **Linear: an offer, no approval, and an explicit statement that it is not capture.** "Once set up, anyone with the matching email domain can join the workspace without an invitation or approval. This is only designed to streamline the joining process and does not prevent users from creating new workspaces with that domain email. Users who are creating new accounts will see a prompt to join the workspace during the onboarding flow." ([Invite members](https://linear.app/docs/invite-members))
- **Slack: an offer, publicly listed, overridden by SSO.** "Workspace Owners and Admins can approve certain email domains to allow anyone with an approved email address to join their workspace. Any email domains you add will be visible on your workspace sign-in page. Note: Enabling single sign-on (SSO) will override your workspace signup preferences." ([Manage how people join your workspace](https://slack.com/help/articles/115004856503-Manage-how-people-join-your-workspace)). The joining user proves the address with an emailed code and then chooses: "Check your email for a confirmation code from Slack and enter it. Below Accept an invitation, click Join next to the workspace you'd like to join." ([Join a Slack workspace](https://slack.com/help/articles/212675257-Join-a-Slack-workspace))
- **Figma: a forced add, gated on DNS verification, with an email notice.** "Before you can enable domain capture, you must verify all the domains you've added." and "When you enable domain capture, Figma immediately adds Figma accounts with matching domains as members to your organization. Each person will:" followed by three list items, "Receive an email letting them know they've been added to the organization", "Join the organization with a View seat", and "Keep access to other teams or organizations they've joined". Going forward: "People who sign up for Figma from verified domains are automatically added as members to your organization. They can still create or join other Starter and Professional teams, or join other organizations." Reversal is deliberately hard: "To disable domain capture, we ask that you contact our support team to walk through the process together." ([source](https://help.figma.com/hc/en-us/articles/360045953273-Manage-domain-capture-for-an-organization))
- **Slack Enterprise claimed domains route by SSO.** "people yet to join your org will have the option to use single sign-on to create an account and contact an Org Admin" (as summarized by search of [Claim domains for an Enterprise organization](https://slack.com/help/articles/115001379947-Claim-domains-on-Enterprise-Grid); see §7, not fetched verbatim).

The pattern: where the domain is unproven (Notion allowed domains, Linear, Slack signup mode) the product only offers a join and the user clicks. Where membership is imposed (Figma capture, Atlassian claim, Dropbox capture) the product demands DNS proof first.

### 2.6 What vendors tell end users about admin visibility

**1Password Business, the nearest analog to a private recipe book.** Published August 6, 2026. ([About your Employee vault](https://support.1password.com/employee-vault/))

- Ownership stated first: "The Employee vault is part of your organization or business account and you should only store work-related passwords in it."
- No direct access, but honest about the edges: "The items in your Employee vault aren't directly available to other team members, but account owners, administrators, or people with specific permissions may be able to access information about your items."
- Aggregates only: "Team members with permission to create team insight reports can see how many items are in your Employee vault."
- The takeover path, described mechanically: "Team members with permission to recover accounts can gain access to your Employee vault and all the items saved there. To do this, they would recover your account, request access to your email address from the IT team, and use the recovery link to create a new account password and Secret Key."
- Where personal things go: "You can use an individual or family account to store personal passwords and other items in 1Password. These accounts are separate from your work account and none of the items in them are available to your employer."

**Dropbox, a question-and-answer page addressed to the member.** Updated Oct 28, 2025. ([Dropbox for teams: Can admins see my account?](https://help.dropbox.com/account-access/admin-control))

- "If you're a member of a Dropbox team, your admin can access your account using the "sign in as a user" feature."
- "By default, everything in your Dropbox team account is private. Other team members can only see your files if you share them using shared folders or links. Admins can view files in your account using sign in as user."
- Whether the member finds out: "How do I know if an admin accessed my account? If your admin has accessed your Dropbox team account using the Sign in as user feature, you may receive an email notification. However, it is at your admin's discretion whether to send this email."
- Offboarding: "If you leave your organization, an admin can remove you from your Dropbox team. They can either suspend, delete, or convert your account."
- The personal boundary: "If you're a team member and you linked your personal and work Dropbox accounts, Sign in as user doesn't allow your admin to open and access your linked personal account." with the residue named: "they can view the name and email address of your linked personal account."
- Activity metadata: "Admins can also view activity logs that show the email addresses of people you've shared with."

**Google, the Managed End-User Notice.** ([Data access by your administrator or service provider](https://support.google.com/accounts/answer/181692?hl=en))

- "Your administrator manages this account and any Google data associated with this account (as further detailed in this article). This means that your administrator can access and process your data, including the contents of your communications, how you interact with Google services, or the privacy settings on your account. Your administrator can also delete your account, or restrict you from accessing any data associated with this account."
- The notice is shown at setup, not only in a help center: "It includes information that was provided to you when your account was set up (called the "Managed End-User Notice")."
- The personal alternative is named: "You can also access Google products not included in Google Workspace by creating a Google Account not managed through Google Workspace."

**Notion.** ([Data your workspace owner can access](https://www.notion.com/help/data-accessible-by-your-workspace-owner))

- "If you are accessing any Notion workspace using an email address or account assigned to you by your employer or other organization [...] it is important to note that the workspace owner could have access to the data you store in that Notion workspace, including any private pages in that workspace. Additionally, the workspace owner can turn off Notion services or restrict your ability to move data to or from the organizational workspace."
- Three things the employment relationship may govern: "Who owns the data or content that you submit or upload through your account", "The conditions under which you may access your account or when your account may be disable", "Who may access or delete the data in your account."
- "You can also access Notion for free, for personal use outside of your managed account, by signing up with your personal email".

**Slack, access to private content is gated by plan and by application.** ([Export your workspace data](https://slack.com/help/articles/201658943-Export-your-workspace-data)): "For legal and regulatory compliance, Workspace Owners can apply to access a self-serve data export tool for messages and file links from public channels, private channels, and DMs in JSON format." and, in the footnote to the plan table, "Workspace Owners and Org Owners must apply to use these export types."

**Google Drive ownership transfer is visible to the person whose files moved.** "The new owner, the previous owner, and the admin who started the transfer get a confirmation email." The documented first step is "Suspend the current owner's account. This action prevents them from creating or moving content during the transfer." ([Transfer Drive files to a new owner as an admin](https://knowledge.workspace.google.com/admin/drive/transfer-drive-files-to-a-new-owner-as-an-admin))

**GitHub Enterprise Managed Users states the constraints plainly.** "Managed user accounts cannot create public content or collaborate outside your enterprise." and "Managed user accounts cannot change their profile name or email address on GitHub." ([About Enterprise Managed Users](https://docs.github.com/en/enterprise-cloud@latest/admin/concepts/identity-and-access-management/enterprise-managed-users))

Recurring shape across these pages: say who owns the account, list what the admin can do as plain verbs, name the aggregate metadata the admin sees, describe the takeover path step by step, say whether the person is notified, and point to a separate personal account for personal things.

### 2.7 Data ownership norms

- **Slack User Terms of Service.** "When an Authorized User (including, you) submits content or information to the Services, such as messages or files ("Customer Data"), you acknowledge and agree that the Customer Data is owned by Customer and the Contract provides Customer with many choices and control over that Customer Data. For example, Customer may provision or deprovision access to the Services, enable or disable third party integrations, manage permissions, retention and export settings, transfer or assign workspaces". The same terms put the duty to inform on the employer: "IT IS SOLELY CUSTOMER'S RESPONSIBILITY TO (A) INFORM YOU AND ANY AUTHORIZED USERS OF ANY RELEVANT CUSTOMER POLICIES AND PRACTICES AND ANY SETTINGS THAT MAY IMPACT THE PROCESSING OF CUSTOMER DATA". ([source](https://slack.com/terms-of-service/user))
- **GitHub Terms of Service, the contrasting personal-account model.** "Users. Subject to these Terms, you retain ultimate administrative control over your Personal Account and the Content within it. Organizations. The "owner" of an Organization that was created under these Terms has ultimate administrative control over that Organization and the Content within it." ([source](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service))
- **Google.** For managed accounts the governing contract is the employer's: "your use of those services is governed by your organization's enterprise agreement. Please reach out to your administrator for a copy of this agreement." ([source](https://support.google.com/accounts/answer/181692?hl=en)). For personal accounts on a work address: "An unmanaged personal account is fully owned and managed by the individual who created it." ([source](https://knowledge.workspace.google.com/admin/users/transfer-unmanaged-personal-accounts))
- **Atlassian.** "A managed account is an Atlassian account your organization has full administrative control of." while an unclaimed account on the same domain stays outside that control: "you can't update their account details or delete their account completely. This is because you don't manage their account." ([source](https://support.atlassian.com/user-management/docs/what-are-managed-accounts/))

---

## 3. What this means for Soup.net (interpretation)

Everything in this section is the researcher's reading, not sourced fact.

**Direct answer to the operator's pushback request.** Nothing is more standard or better than DNS TXT. It is the one method every vendor sampled offers, the only one four of them offer, and the one the IETF working-group draft recommends. The part worth pushing back on is placement. Most big vendors still put the record at the apex, the draft calls that "common but unfortunate", and GitHub's dedicated label is the better pattern. A `_soupnet-challenge.<domain>` label costs the customer nothing extra and avoids colliding with the SPF and other verification strings that already crowd the apex.

**On "HTTPS is weaker".** The planning doc's instinct is right for this use, but the vendors do not phrase it as weakness, so the doc should not either. The defensible argument is scope: what Soup.net needs proven is control of the domain that routes email, because auto-join and claiming are keyed on email addresses. A file on `www` proves control of a web host. DNS proves the zone. That is a reason to make DNS the only method at launch, and it is a reason Soup.net can state without calling anyone else's method insecure.

**On the Google `hd` idea as a second factor.** Atlassian's "verify via Google Workspace" option is precedent for leaning on an identity provider's own domain verification. It fits as a convenience later, and the planning doc's caution still holds: it proves Workspace membership, not authority to bind the company.

**Re-verification should be persistent, with Atlassian's two-stage shape.** The planning doc suggests "freeze auto-join and alert, never dissolve the org". Atlassian supports the spirit and adds a concrete schedule: warn, hold a "verified, expires soon" state for 14 days, then drop to unverified. Its failure consequence is that accounts become unclaimed while "users still keep their app access". For Soup.net the equivalent soft failure is: stop auto-join and stop new claims immediately when the record goes missing, keep existing members and books intact, alert org admins, and only after the grace period mark the domain unverified. The IETF draft's §9.11 and §9.13 are the argument for never treating a later re-verification by a different party as reactivation of the old org: a new org proving the same domain must start empty.

**One domain, one org; no subdomain inheritance; block public domains.** All three of the planning doc's design points match the majority practice quoted above. The public-domain blocklist should also include the public suffix list, per the draft.

**The claim flow: the planning doc's description matches Google, Dropbox, and Notion, and does not match Atlassian.** Atlassian gives the person no choice and only an in-app notice. Under Soup.net's ratified "managed, no mixing" model (recipe 2301b5eb) a claim changes who controls a person's recorded taste and judgment, so the Atlassian design is the wrong one to copy and the Google design is the right one: an emailed request, the person's own click plus agreement to terms, data stays personal if they rename instead, and conversion is one-way. Three details from the vendors are worth carrying over:

- Notion's waiting period. Nothing claimable for 14 days after verification, with a notice sent at the start. This is cheap protection against a hostile or mistaken verification.
- Google's export-before-transfer advice. Soup.net already has a user export, so the claim notice can link to it.
- Dropbox's information gate. Before verification the admin learns nothing; after verification, a count first. This matters for Soup.net because the invitation flow was designed so that nobody can "fish for who's on the system". A verified domain owner has a legitimate claim to know which accounts sit on its domain, but the list should appear only after DNS proof and should be audit-logged.

**What happens at the deadline.** Google's answer is the closest to the planning doc's suggestion: the personal account survives with its data, but it loses the company address (forced rename at next sign-in). Dropbox and Notion are harsher: they block access until the person picks. The planning doc's "keeps working but can't use the company email for login until the user chooses" is the Google shape, and it is the gentlest one that still gives the company its domain back.

**Auto-join and the two anti-spam principles.** `docs/design-thinking.md` holds two principles that domain features touch:

- "No auto-accept (anti-spam principle)": invitations "stay pending. I have to click Accept. This prevents someone from forcing me into recipe books by guessing my email and planting an invite before I sign up."
- "No emails to non-users (anti-spam principle)": "Soup.net never sends email to addresses that don't already have an account."

Auto-join is a deliberate exception to the first (recorded as such in recipe f653c2f1, flagged there for operator confirmation). How vendors reconcile the same tension:

- The threat that "no auto-accept" guards against is a stranger asserting a relationship by knowing an email address. Vendors remove the stranger by requiring proof on both sides before membership is imposed. The org proves the domain by DNS (Figma: "Before you can enable domain capture, you must verify all the domains you've added"). The person proves the mailbox by a code or by SSO (Slack: "Check your email for a confirmation code"). An attacker who can plant an invite cannot plant a DNS record on someone else's domain.
- Where the org has not proven the domain, vendors fall back to exactly Soup.net's existing principle: an offer the user clicks. Notion: "they'll see the option to join your workspace during onboarding". Linear: "will see a prompt to join". That gives Soup.net a clean rule: forced membership only behind DNS proof; anything less is an offer.
- Even with proof, vendors that force-add still tell the person. Figma: "Receive an email letting them know they've been added to the organization". For Soup.net this is compatible with "no emails to non-users", because auto-join happens at or after signup, when the address already belongs to an account that has verified it.
- The second principle is under more pressure from claiming than from auto-join. Claim notices go to existing account holders, so they comply. Backfill stub accounts (program doc §4.4) are the case that would break it, and that is outside this topic.
- One honest difference from an invitation: under the managed model, joining is not a social act the person can decline while keeping the address. The person's real choice moved earlier, to which email they sign up with. The signup screen for a captured domain should therefore say, before the account is created, that the account will belong to the organization. Google does this with its Managed End-User Notice "provided to you when your account was set up".

**The end-user transparency page.** 1Password's Employee vault page is the model. Its posture is the same as the operator's stated position in recipe 57fc1eee: no direct admin access to private content, aggregate counts visible, and a takeover path that exists and is described honestly rather than hidden. Suggested skeleton, each item taken from a vendor pattern in §2.6:

1. Who owns this account (1Password's first sentence; Google's first sentence).
2. What admins can do, as plain verbs (Atlassian: "manage your account details, require security measures, and delete your account").
3. What admins can see: counts and activity dates, not book names or recipe text (1Password: "can see how many items are in your Employee vault").
4. How the organization could reach your private books anyway, step by step (1Password's recovery paragraph). With `require_sso`, this is the company's control of the Google identity, and the page should say so.
5. Whether you are told when it happens. Here Soup.net can do better than Dropbox, whose notice is "at your admin's discretion". The program doc's two-way observability principle implies always.
6. What happens when you leave (Dropbox: "suspend, delete, or convert"; Google Drive transfer emails "the previous owner").
7. Where to keep things that are yours (every vendor sampled points to a separate personal account, which is the operator's own ratified answer).

**Data ownership.** The operator's starting frame, that data created by the company account stays in the company's control, is the norm and Slack's user terms state it most directly ("Customer Data is owned by Customer"). Slack also shows where the duty to inform sits: with the employer, by contract. Soup.net's terms will need a parallel clause, and the transparency page does part of the informing on the employer's behalf.

---

## 4. Options with tradeoffs

**A. Verification method**

| Option | For | Against |
|---|---|---|
| A1. DNS TXT at a dedicated `_soupnet-challenge` label, only method | Matches the IETF draft's recommendation and GitHub. Proves the zone that routes email. One code path. | A customer whose IT is slow with DNS has no fallback, so the site-admin manual override stays necessary. |
| A2. DNS TXT at the apex | Matches what Google, Atlassian, and Slack admins already know: "enter @". | The draft calls it "common but unfortunate"; shares an RRset with SPF and other vendors' tokens. |
| A3. A1 plus an HTTPS file as a second method | Atlassian's resilience argument: "your domain will remain verified even if one verification method expires." | Proves a web host, not the mail domain. Second code path and a server-side fetch of customer URLs to secure. |

**B. Validation lifetime**

| Option | For | Against |
|---|---|---|
| B1. Persistent: record must stay, periodic re-check, warn, grace period, then unverified with soft consequences | Atlassian, Search Console, GitHub Pages. Answers the domain-changes-hands hazard. Record removal doubles as the customer's own revocation switch. | A DNS cleanup at the customer can silently start the clock; needs alerting and a status UI. |
| B2. One-off: verify once, record may be deleted | GitHub organizations. Simplest. | No signal when a domain lapses or is sold. Linear's answer to that is to ask customers to remember. |

**C. Pre-existing accounts on the domain**

| Option | For | Against |
|---|---|---|
| C1. Invite to convert, with rename-to-personal as the exit, a waiting period, and loss of the company address at the deadline (Google shape plus Notion's delay) | Person's click and consent; data stays theirs if they leave; company still gets its domain back. | Slowest for the admin. Stragglers need a deadline rule. |
| C2. Forced choice at next sign-in: join or change email (Dropbox shape) | Fast, still a real choice. | Blocks the person's work until they decide; no time to export or think. |
| C3. Unilateral claim with after-the-fact notice (Atlassian shape) | Fastest, simplest. | Transfers control of a person's recorded taste and judgment without consent. Conflicts with the program doc's "Never auto-convert silently." |

**D. Auto-join for new signups**

| Option | For | Against |
|---|---|---|
| D1. Forced membership at signup, behind DNS proof plus mailbox or SSO proof, with a pre-signup notice (Figma shape plus Google's notice) | What the operator asked for; day-one shared ground. | The exception to "no auto-accept" must be stated in design-thinking.md. |
| D2. Offer at onboarding, user clicks Join (Notion, Linear, Slack shape) | Preserves "no auto-accept" untouched. | Under "managed, no mixing" a company-domain account that declines has no coherent status. |

---

## 5. Recommendation

1. **A1.** DNS TXT at `_soupnet-challenge.<domain>`, token carrying no org identifier (the draft's privacy note: records "should be considered to be public information"). DNS only at launch. Keep the site-admin manual override for the first customer.
2. **B1.** Persistent validation. Publish the re-check frequency and the grace period in the admin docs, since the draft makes both a MUST. On a missing record: stop auto-join and new claims at once, alert org admins, hold existing membership and books, and mark unverified after a grace period. Atlassian's 14 days is the one published number found. A later verification of the same domain by a different org never inherits the old org's members or data.
3. One org per domain with a unique constraint; subdomains verified separately; blocklist of public email domains plus the ICANN public suffix list. Challenge tokens expire after one week (Notion's number) and the UI says so.
4. **C1.** Invite to convert with a link to the user export, rename-to-personal as the always-available exit, a waiting period after verification before any claim can be sent, and at the deadline the unconverted account keeps its data and loses the company address. The list of accounts on a domain is shown to org admins only after DNS proof, and viewing it is audit-logged. Do not act on an account whose email is unverified (Atlassian's guard).
5. **D1**, with three conditions: DNS-verified domain, the joining user has proven the mailbox (verification click, or Google SSO per the program doc's `hd` rule), and the signup screen says before account creation that the account will belong to the organization. Record the exception next to the two anti-spam principles in design-thinking.md so the rule reads: membership is imposed only behind domain proof; everything else remains an offer the person accepts.
6. Write the end-user page on the 1Password skeleton in §3, and make member-visible notification of admin actions unconditional.

---

## 6. Open questions for the operator

1. Grace period length for a missing DNS record, and re-check frequency. Atlassian's 14 days is the only published figure found. Is that the right number for a product whose API keys keep working meanwhile?
2. Claim deadline. Google lets the admin choose the follow-up duration. Should Soup.net fix one (Notion's 14 days is a precedent) or let the org admin set it within bounds?
3. Should an org admin see the list of pre-existing accounts on the domain (Atlassian: full CSV) or only a count until each person responds (Dropbox: a count in the insights column)? This is the point where the "can't fish for who's on the system" story meets a legitimate domain owner.
4. Auto-join confirms recipe f653c2f1's framing as a deliberate exception. Does the operator want the design-thinking.md wording changed now, or when the feature ships?
5. Does a personal account that renames away from the company domain keep any org-book memberships it had as a guest, subject to the org's sharing policy, or is it removed from org books at rename?
6. Educational domains: Notion excludes them from claiming. Does Soup.net want the same carve-out, given students and staff share a domain and the "company owns the account" premise is weaker there?
7. Is the HTTPS file method wanted later as a resilience backup (Atlassian's argument), or is DNS-only a permanent position?

---

## 7. Unverified / could not confirm

- **Stripe.** The planning doc lists Stripe among vendors using DNS TXT. No Stripe page on organization domain verification was located in this pass. The claim is unconfirmed and should be dropped from the list or sourced separately.
- **GitHub organization challenge label.** The exact `_github-challenge-ORGNAME` label for organization domains is shown in GitHub's UI, not on the docs page fetched. Only the Pages label (`_github-pages-challenge-...`) is quoted from a primary source here.
- **"Email to admin@ / postmaster@ is weak."** No sampled vendor offers email-based domain verification, and no primary source was collected for its weakness. CA/Browser Forum materials would be the place to look. Left out of the findings.
- **Slack Enterprise claimed domains.** The sentence about people using single sign-on to create an account came from a search summary of the Slack help article, not from a verbatim fetch. Treat as unverified wording.
- **Slack domain claim re-verification**, **Notion re-verification**, **Figma re-verification**, and **Google Workspace periodic re-check of the primary domain**: none of the fetched pages says whether the record must stay. Not confirmed either way.
- **Atlassian's user-facing options after a claim.** The fetched pages describe no way for a claimed user to decline or to move the account to a personal email on their own. Absence on these pages is not proof that no such path exists.
- **Microsoft Entra notice to users during admin takeover.** The takeover page describes none. Not confirmed either way.
- **Dropbox file transfer at offboarding** and whether the departing member is notified: not fetched. Only the member-facing sentence "They can either suspend, delete, or convert your account" is sourced.
- **Truffle Security write-up on domain resale and `hd` claims** (program doc §3.4) is outside this topic and was not checked here; the IETF draft §9.11 and §9.13 quotes cover the same hazard from the verification side.
