# Backups and restore

The hub backs up its SQLite database itself (NFR-7). It never copies the live file; it uses SQLite's online backup API, which is safe while the hub is running in WAL mode.

## What happens automatically

- Every night at 03:30 (the container's `TZ`), and once at startup if the newest backup is more than 24 hours old.
- Files go to `${HUB_DATA_DIR}/backups/hub-YYYY-MM-DDTHHmmZ.db` (UTC timestamp in the name). Each is checked with `PRAGMA integrity_check` before it is kept.
- Retention: everything from the last 30 days is kept, and the 7 newest are always kept even if older.
- A failed backup is logged (`[backup] failed: ...`) and never stops the hub.
- Disable with `HUB_BACKUPS=off` in `.env`.

Adults can check status or run one now: `GET /api/backups` (list and last result), `POST /api/backups` (run now).

## Second layer

The backup folder lives inside the data folder, so it dies with the disk. Keep an off-disk copy too:

- Unraid: include the hub's appdata folder in the Unraid appdata backup plugin.
- Mac Studio: Time Machine must include the data folder (do not exclude it).

## Restore

Restoring replaces the current database, so stars earned since the backup are lost. Keep a copy of the broken file until you are sure.

```sh
cd <folder containing compose.yaml>
docker compose stop hub
cd "${HUB_DATA_DIR:-./data}"
mv hub.db hub.db.broken
rm -f hub.db-wal hub.db-shm
cp backups/hub-YYYY-MM-DDTHHmmZ.db hub.db   # pick the backup you want
docker compose start hub   # run from the compose folder
```

Removing `hub.db-wal` and `hub.db-shm` matters: stale sidecar files from the old database would be applied to the restored one. Make sure the restored file is owned by `PUID:PGID` (on Unraid: `chown 99:100 hub.db`). Pending migrations are applied automatically at startup.

## Restarts and shutdown

`docker stop`, `docker compose restart` and image updates send SIGTERM. The hub stops accepting connections, stops its schedulers, lets a backup or photo render that is already running finish (at most 2 seconds), closes the database and exits with code 0, well inside Docker's 10 second limit, so it is never SIGKILLed mid-write. A backup is written to a `.partial` file and renamed only after `integrity_check` passes, so a backup cut short by a stop never shows up in the list as a valid file.
