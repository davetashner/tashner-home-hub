# Connect Spotify (shower music)

The hub plays Spotify through a Connect speaker on the Pi. It needs one household Spotify **Premium** account and a free developer app that **you** create. Sign-in uses OAuth with PKCE, so there is no client secret to store.

## Why https matters

Spotify only accepts `https` redirect addresses (plus `http://127.0.0.1` for local development). Use the hub's https address (for example `https://hub.example.com`, served by your reverse proxy) when you connect. The redirect address is built from the address you opened the hub at, so connecting from a plain-http LAN address is refused with a clear message.

## 1. Create the Spotify app

1. Open <https://developer.spotify.com/dashboard> and **Create app** (name it "Home Hub").
2. Add this **Redirect URI** exactly: `https://<your-hub-host>/api/spotify/callback`
3. Under "Which API/SDKs are you planning to use?", tick **Web API**.
4. Save, then copy the **Client ID**.
5. **User Management**: apps start in development mode, which only lets listed users sign in. Add the name and email of the Spotify account you will connect.

## 2. Configure the hub

Add the client id to the `.env` next to `compose.yaml` (never commit this file), then restart the hub:

```
HUB_SPOTIFY_CLIENT_ID=your-client-id
```

## 3. Connect

In **Settings > Music** (adult PIN required) choose **Connect Spotify**, sign in, and approve. The page then shows "Connected as <name>". The hub asks for these scopes: `user-read-playback-state`, `user-modify-playback-state`, `playlist-read-private`, `playlist-read-collaborative`.

The refresh token is encrypted with the hub's secret key (`HUB_SECRET_KEY` or the key file) and never shown. **Disconnect** deletes it.

## Troubleshooting

- **"Spotify isn't set up"**: `HUB_SPOTIFY_CLIENT_ID` is empty or the hub was not restarted.
- **INVALID_CLIENT: Invalid redirect URI** on Spotify's page: the Redirect URI in the dashboard does not match the address you opened the hub at.
- **"Spotify refused this account"**: add the account under User Management in the Spotify dashboard.
- **"needs to be reconnected"**: Spotify revoked the saved sign-in (for example you removed the app in your Spotify account). Connect again.
