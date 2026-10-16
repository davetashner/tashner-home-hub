# Migrate the hub to another host (Unraid to Mac Studio)

All state lives in the data folder (the `/data` bind mount): database, uploads, and encrypted credentials. Moving the hub means moving that folder, keeping the secret key, and repointing the kiosk (NFR-11).

## Before you start

- Keep `HUB_SECRET_KEY` (in `.env`) identical on both hosts. Without it, stored credentials cannot be decrypted. Store it in your password manager.
- Set up the new host through [mac-studio.md](mac-studio.md) up to, but not including, the first `docker compose up`.

## Steps

1. **Stop the old hub** so the database is not mid-write:
   ```sh
   # on Unraid
   cd /mnt/user/appdata/home-hub && docker compose down
   ```
2. **Copy the data folder** (preserves everything, including hidden files):
   ```sh
   rsync -a --info=progress2 root@192.168.1.10:/mnt/user/appdata/home-hub/data/ ~/home-hub/data/
   ```
3. **Copy `.env`** values that matter (`HUB_SECRET_KEY`, `TZ`), then fix host-specific ones (`HUB_DATA_DIR`, `PUID`, `PGID`).
4. **Start the new hub**:
   ```sh
   cd ~/home-hub && docker compose up -d && curl http://localhost:3000/healthz
   ```
5. **Check the data** by opening the hub in a browser and confirming your calendar, lists and photos are present.
6. **Repoint the Pi kiosk.** SSH to the Pi and change the URL Chromium loads (placeholder shown):
   ```sh
   ssh -l <pi-user> kiosk.local
   # edit the kiosk autostart/service file, replace the old URL
   #   http://192.168.1.10:3000  ->  http://192.168.1.20:3000
   sudo reboot
   ```
   Using a stable hostname such as `hub.local` (or a router DNS entry) means future moves need no kiosk change.
7. **Keep the old data** for a week as a rollback, then delete it.

## Rollback

`docker compose down` on the new host, `docker compose up -d` on the old one, and point the kiosk back.
