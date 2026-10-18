# Deploy on the Mac Studio (December 2026)

Docker runs through [OrbStack](https://orbstack.dev). The image is multi-arch, so the same `compose.yaml` runs natively on Apple silicon (linux/arm64).

## 1. Install OrbStack

```sh
brew install --cask orbstack
```

Open OrbStack once, then enable **Settings > General > Start at login**. OrbStack starts the Docker engine at login, and the container's `restart: unless-stopped` brings the hub back with it.

Also enable automatic login for the hub user (System Settings > Users & Groups) and turn off sleep (System Settings > Energy > "Prevent automatic sleeping when the display is off") so the hub survives power cuts and reboots.

## 2. Create the folder

```sh
mkdir -p ~/home-hub/data && cd ~/home-hub
```

Copy `compose.yaml` and `.env.example` here (or clone the repo), then `cp .env.example .env` and set:

```
HUB_DATA_DIR=/Users/<you>/home-hub/data
PUID=501        # output of `id -u`
PGID=20         # output of `id -g`
TZ=America/Chicago
```

OrbStack maps file ownership for bind mounts, so the defaults generally work; setting PUID/PGID to your own IDs is the safe choice.

## 2b. Photo folder (optional)

Set `HUB_PHOTO_DIR` in `.env` to the folder the photo frame should read. From December the native
`osxphotos` helper exports your chosen Apple Photos albums into this same kind of folder (one
subfolder per album). It is mounted read-only at `/media/photos-in`:

```
HUB_PHOTO_DIR=/Users/<you>/HubPhotos
HUB_PHOTO_ROOTS=/media/photos-in
```

Then add `/media/photos-in` in **Settings > Photo library**. OrbStack must be allowed to read the folder
(System Settings > Privacy & Security > Files and Folders).

## 3. Start

```sh
docker compose pull
docker compose up -d
docker compose ps    # healthy
curl http://localhost:3000/healthz
```

## 4. Reach it from the kiosk

Use the Mac's LAN name or a reserved IP (for example `http://hub.local:3000` or `http://192.168.1.20:3000`). Reserve the IP in the router so it does not change.

## Updating

```sh
docker compose pull && docker compose up -d   # the image is built by CI; see unraid.md for GHCR access
```

## Backups

The hub backs itself up nightly into `backups/` under the data folder. Make sure Time Machine includes the data folder as a second layer. See [backup-restore.md](backup-restore.md) for retention and how to restore.
