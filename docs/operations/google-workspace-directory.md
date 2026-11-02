# Connecting your Google Workspace directory

For a company organization on Soup.net. Once connected, Soup.net checks each member on your domain against your Google Workspace directory, at most once an hour, at the moment they or their agents use Soup.net. A person you suspend, archive or remove in Google loses access to Soup.net, sessions and agent keys alike, usually within the hour. Restore them in Google and the same keys work again. Nothing is copied from your directory: Soup.net asks about one person at a time and keeps only whether they are active.

Who is checked: members whose Soup.net address is on the domain you connect (exactly that domain; subdomains are separate), or who sign in to Soup.net with a Google Workspace account on it. Every such address must be a Workspace user or an alias of one: a group address or a forwarder reads as "not in the directory" and is switched off.

## Before you start

- Your organization has verified the domain in Soup.net (the console's Domains page).
- You are an owner or admin of the organization in Soup.net.
- For the admin-consent way, you are also a Google Workspace admin who can read users, and you have signed in to Soup.net with Google at least once.

## Seats

A person the directory switches off keeps their seat, so they can't find the organization full when you restore them in Google. To free the seat for someone else, disable them in your organization's console as well. Restoring them after that needs a free seat, like enabling anyone else.

## Way 1: consent as a Workspace admin

1. In the Google Admin console, go to Security, Access and data control, API controls, Manage third-party app access, and mark Soup.net as **Trusted**. ([Google: Control which third-party & internal apps access Google Workspace data](https://support.google.com/a/answer/60757))
2. In Soup.net's console, choose your domain and **Connect with Google**. Google asks you for read-only access to your directory's users; approve it.
3. Soup.net checks that it can read your own entry, then saves the connection. If you stop being an owner or admin in Soup.net before you finish, nothing is saved.

The connection uses your own consent. When you leave the company or lose admin rights, it stops working, so before offboarding the admin who connected, reconnect as another admin, or switch to way 2.

Google may show an "unverified app" screen to the consenting admin, since Soup.net hasn't been through Google's review for the directory scope; continuing past it is what trusting the app in step 1 is for. If Google won't allow the consent at all, use way 2.

## Way 2: your own service account

1. In your own Google Cloud project, create a service account and a JSON key for it.
2. In the Google Admin console, under Security, Access and data control, API controls, **Manage domain-wide delegation**, add the service account's client ID with exactly one scope: `https://www.googleapis.com/auth/admin.directory.user.readonly`. Google's caution applies: "With domain-wide delegation, the app has access to the data belonging to all of your users", which is why it gets only this read-only scope. ([Google: Control API access with domain-wide delegation](https://knowledge.workspace.google.com/admin/apps/control-api-access-with-domain-wide-delegation))
3. In Soup.net's console, paste the JSON key and the address of a Workspace admin on your domain for it to act as. Soup.net checks it can read that admin's entry, then stores the key encrypted. You can revoke it in Google at any time.

## What happens when the connection breaks

If Soup.net can't read your directory (Google refuses the credential, can't be reached, or sends back something other than a complete record of the person), it keeps using the last status it has, and the console shows the error until a later check succeeds. Your organization's owners and admins get an email naming who the failed check was about, when the last successful check was, and the hour everyone will be signed out by. It comes at the first failure when Google refuses the credential or answers badly, at most once a day. When Google just doesn't answer in time, which can happen to anyone now and then, it comes after six hours without a successful check, or sooner if that stops someone disconnecting. A member with no successful check for a day is signed out and their agents' keys stop working until a check succeeds, because Soup.net can no longer confirm they still work for you.

The checks need your domain's verification in Soup.net to stay current. If its DNS check fails or the TXT record is removed, Soup.net stops checking and stops signing people out for want of a check, but anyone the directory already showed as suspended, archived or removed stays signed out. Your owners and admins get the domain's email saying so, and the console shows the checks as paused. Once the record is back and the domain verifies again, checks resume, and anyone restored in Google in the meantime gets access back at their next check.

To fix it, reconnect (either way) from the console. If that's no longer possible because every owner and admin is locked out too, contact Soup.net support: the site operator can remove the connection by hand, which lets everyone back in, and you can reconnect after.

## Disconnecting

Disconnect from the console. Checks stop at once, anyone the directory had switched off works again, and your organization's other owners and admins get an email saying who did it.

Soup.net first asks your directory about the person disconnecting, so someone you have suspended in Google can't end the checks, even in the hour before their own next check. Replacing the connection with a service-account key asks the same thing.

If your directory can't answer at that moment, the connection stays, your other owners and admins are warned if they haven't been already, and Soup.net says why. Try again shortly, or reconnect now, which needs only a credential that works. If you can't reconnect, Soup.net support can remove it, or you can disconnect six hours after that warning. The six hours are there so that someone you have just suspended, whose own consent stopped working when you did, can't end the checks before anyone else hears about it. If you get that warning and aren't expecting it, reconnect the directory yourself.

Reconnecting, or replacing the connection with a key, lets back in anyone the directory had switched off until their next check, which comes when they next use Soup.net. Replacing it with a key asks your directory about the person doing it, and waits in the same way if it can't answer.

If several members are found removed from your directory within an hour, they are switched off at once, and your owners and admins get an email so they can tell a departure from a fault.
