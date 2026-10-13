# Persistent production uploads

The API and worker share the Docker named volume `crm_uploads` at
`/app/uploads`. This holds library files and template attachments. Container
replacement preserves the volume; server/disk loss still requires backups.

## First rollout on the production server

Preserve existing uploads before recreating the API container. Run from the
deployment directory. Schedule a short maintenance window: API and worker
are stopped while files are copied so new uploads cannot race with migration.

```sh
upload_backup_dir="$PWD/uploads-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$upload_backup_dir"
docker compose -f docker-compose.prod.yml stop api worker
docker cp crm_api:/app/uploads/. "$upload_backup_dir/"
```

If the copy fails, investigate before continuing; do not recreate the old
container. Keep the backup outside Git and include it in server backups.

Create the volume and copy the saved uploads with the installed API image:

```sh
docker volume create crm_uploads
docker run --rm --user root --entrypoint sh \
  --mount type=volume,source=crm_uploads,target=/app/uploads \
  --mount "type=bind,source=$upload_backup_dir,target=/backup,readonly" \
  crm-api:latest -c \
  'cp -an /backup/. /app/uploads/ && mkdir -p /app/uploads/files /app/uploads/templates && chown -R crm:crm /app/uploads'
docker compose -f docker-compose.prod.yml up -d api worker
```

The copy preserves existing destination files. Check both containers' mounts:

```sh
docker inspect crm_api crm_worker --format '{{.Name}} {{json .Mounts}}'
```

Both must show `crm_uploads` mounted at `/app/uploads`. Upload a test image,
confirm its preview, recreate API and worker, then verify the preview still
loads. Verify a template attachment can be sent through the worker as well.

Never use `docker compose down -v` or delete `crm_uploads` during routine
deployments. This setup does not recover files already lost from old
containers; restore them from backup or re-upload them.

Configure `APP_BASE_URL` as the public HTTPS application origin so newly stored
file links are reachable by recipients.
