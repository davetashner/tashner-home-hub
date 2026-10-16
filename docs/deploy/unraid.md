# Deploy on Unraid

The hub is one container. Data lives in a single folder you can back up or move (see [migrate.md](migrate.md)).

## 1. Prepare the appdata folder

```sh
mkdir -p /mnt/user/appdata/home-hub/data
chown -R 99:100 /mnt/user/appdata/home-hub/data   # nobody:users, Unraid's default
```

The container never runs as root. `compose.yaml` runs it as `PUID:PGID`, so that user must own the data folder.

## 2. Get the files

Copy `compose.yaml` and `.env.example` from the repo into `/mnt/user/appdata/home-hub/`, then:

```sh
cd /mnt/user/appdata/home-hub
cp .env.example .env
```

Edit `.env`:

```
HUB_DATA_DIR=/mnt/user/appdata/home-hub/data
PUID=99
PGID=100
HUB_PORT=3000
TZ=America/Chicago
```

## 3a. Start with the Compose Manager plugin

1. Install **Docker Compose Manager** from Community Applications.
2. Docker tab, **Add New Stack**, name it `home-hub`.
3. Edit the stack: paste `compose.yaml`; under **Edit Env File** paste your `.env`.
4. **Compose Up**.

## 3b. Or start from the CLI

```sh
cd /mnt/user/appdata/home-hub
docker compose pull
docker compose up -d
```

If the image is not published yet, clone the repo instead and run `docker compose up -d --build`.

## 4. Verify

```sh
docker compose ps                      # STATUS shows "healthy"
curl http://192.168.1.10:3000/healthz  # use your Unraid IP
```

Point the kiosk at `http://192.168.1.10:3000` (or a hostname such as `hub.local`).

## Updating

```sh
docker compose pull && docker compose up -d
```

Pin a release with `HUB_TAG=<version>` in `.env` to avoid surprise upgrades.

## Troubleshooting

- `EACCES` / "permission denied" on `/data`: the data folder is not owned by `PUID:PGID`. Re-run the `chown` above.
- Port taken: change `HUB_PORT`.
- Logs: `docker compose logs -f hub` (rotated at 3 x 10 MB).

## Backups

The hub backs itself up nightly into `backups/` under the data folder. Also include the hub appdata folder in Unraid's appdata backup. See [backup-restore.md](backup-restore.md) for retention and how to restore.
