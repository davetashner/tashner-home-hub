# Connect Google Calendar

The hub reads your Google calendars (read-only) using a free Google Cloud project that **you** create. Nothing is billed and no public domain or https is needed.

## Why "paste the address" sign-in

Google only allows `https` redirect addresses for web apps, and the hub lives at a plain-http LAN address such as `http://hub.local:3000`. Google's device sign-in flow does not permit Calendar scopes either. So the hub uses a **Desktop app** OAuth client: you approve access on any phone or laptop, Google then sends the browser to `http://127.0.0.1:9004/?code=...`, which fails to load (nothing is listening there, on purpose). You copy that address from the browser's address bar and paste it into the hub.

## 1. Create the Google Cloud project

1. Open <https://console.cloud.google.com/> and create a project (for example "Home Hub").
2. **APIs & Services > Library**: search for **Google Calendar API** and click **Enable**.
3. **APIs & Services > OAuth consent screen** (Google Auth Platform): choose **External**, fill in the app name and your email, and add the scope `https://www.googleapis.com/auth/calendar.readonly`.
4. **Publish the app: set the publishing status to "In production".** Unverified is fine for personal use. If you leave it in "Testing", Google expires refresh tokens after 7 days and the wall calendar will stop updating weekly. You will see an "unverified app" warning when you approve access; choose **Advanced > Go to (app name)**.
5. **Credentials > Create credentials > OAuth client ID**, application type **Desktop app**. Copy the client ID and client secret.

## 2. Configure the hub

Add the values to the `.env` next to `compose.yaml` (never commit this file), then restart the hub:

```
HUB_GOOGLE_CLIENT_ID=your-client-id
HUB_GOOGLE_CLIENT_SECRET=your-client-secret
```

## 3. Connect an account

From the admin screen (adult PIN required):

1. Start a Google connection. The hub gives you a Google link; open it on any device and sign in with the account that owns the calendars.
2. Approve **See and download any calendar you can access using your Google Calendar**.
3. The browser then shows a "can't reach this site" page for `127.0.0.1:9004`. That is expected. Copy the **entire address** from the address bar and paste it into the hub.
4. Choose which calendars to show and which family member each belongs to. The primary calendar is selected by default.

The refresh token is encrypted with the hub's secret key (`HUB_SECRET_KEY` or the key file) and never shown again.

## Troubleshooting

- **"needs to be reconnected"** on the admin screen: Google rejected the saved sign-in (password change, access removed, or the app was left in Testing). Reconnect the account; your calendar choices are kept.
- **"Google rejected the client id or secret"**: re-copy both values from the Cloud console; the client type must be **Desktop app**.
- **"did not return a long-lived sign-in"**: remove the app at <https://myaccount.google.com/permissions> and connect again.
- API endpoints used by the UI: `POST /api/calendar/google/start`, `POST /api/calendar/google/finish` (`{ pasted, state, label?, sourceId? }`; pass `sourceId` to reconnect an existing account).
