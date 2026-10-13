"""Keep the newest encrypted backup and cap total backup storage."""
import json
import os
import re
import subprocess

bucket = os.environ["R2_BACKUP_BUCKET"]
endpoint = os.environ["R2_ENDPOINT"]
limit = int(os.environ.get("BACKUP_STORAGE_LIMIT_BYTES", "3221225472")) - int(os.environ.get("BACKUP_RESERVED_BYTES", "0"))
command = ["aws", "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "database/", "--endpoint-url", endpoint, "--output", "json"]
items = json.loads(subprocess.check_output(command)).get("Contents", [])
items.sort(key=lambda item: item["LastModified"])
total = sum(item["Size"] for item in items)
for item in items[:-1]:
    if total <= limit:
        break
    if not re.fullmatch(r"database/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.dump\.age", item["Key"]):
        raise RuntimeError("Unexpected backup key; manual review required")
    subprocess.run(["aws", "s3api", "delete-object", "--bucket", bucket, "--key", item["Key"], "--endpoint-url", endpoint], check=True, stdout=subprocess.DEVNULL)
    total -= item["Size"]
if total > limit:
    raise RuntimeError("Newest backup alone exceeds backup storage budget")
print("Backup storage within configured limit")
