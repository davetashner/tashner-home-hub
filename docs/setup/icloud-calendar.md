# Connect an iCloud calendar

The hub reads iCloud calendars over CalDAV using an app-specific password. Your
normal Apple ID password is never needed and never stored.

## 1. Create an app-specific password

1. Sign in at <https://appleid.apple.com>.
2. Open **Sign-In and Security**, then **App-Specific Passwords**.
3. Choose **Generate an app-specific password**, name it "Home Hub", and copy it
   (it looks like `abcd-efgh-ijkl-mnop`).

Two-factor authentication must be on for the Apple ID.

## 2. Add the source

As an adult, send `POST /api/calendar/sources` (the admin UI uses the same call):

```json
{
	"provider": "icloud",
	"label": "Apple",
	"appleId": "jane@example.com",
	"appPassword": "abcd-efgh-ijkl-mnop"
}
```

The hub connects once to check the password. If Apple rejects it you get a
message pointing back to step 1. On success the response lists every event
calendar on the account (reminder lists are skipped), each with
`selected: false`.

## 3. Choose calendars and members

`PATCH /api/calendar/sources/<id>` with
`{"calendars":[{"externalId":"<url>","selected":true,"memberId":"<member>"}]}`
shows a calendar and assigns it to a family member. Unselected calendars are not
synced.

## Notes

- The Apple ID and password are encrypted with the hub key; the API only shows
  the Apple ID masked (`j•••@example.com`).
- If you revoke the password, the source shows **needs re-auth** after the next
  sync. Create a new password and re-add the source.
- This connector is read-only.
