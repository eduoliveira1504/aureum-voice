"""Copies the MinIO bucket to and from a tar stream, keeping each object's Content-Type (the API
serves files with it, so a plain file copy would lose it). Runs inside the API container, which
already has the minio client and the credentials in its environment; nothing is printed but counts.

  python media_archive.py export > media.tar
  python media_archive.py import < media.tar

Each object is a tar member named by its key; its Content-Type goes in a PAX header.
"""

import os
import sys
import tarfile

from minio import Minio

CONTENT_TYPE = "aureum.content_type"


def client() -> Minio:
    return Minio(
        os.environ["MINIO_ENDPOINT"],
        access_key=os.environ["MINIO_ROOT_USER"],
        secret_key=os.environ["MINIO_ROOT_PASSWORD"],
        secure=False,
    )


def export(mc: Minio, bucket: str) -> None:
    count = size = 0
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        for obj in mc.list_objects(bucket, recursive=True):
            response = mc.get_object(bucket, obj.object_name)
            try:
                info = tarfile.TarInfo(obj.object_name)
                info.size = obj.size
                info.mtime = int(obj.last_modified.timestamp()) if obj.last_modified else 0
                info.pax_headers = {CONTENT_TYPE: response.headers.get("Content-Type", "application/octet-stream")}
                tar.addfile(info, response)
            finally:
                response.close()
                response.release_conn()
            count += 1
            size += obj.size
    print(f"exported {count} objects, {size / 1e6:.1f} MB", file=sys.stderr)


def restore(mc: Minio, bucket: str) -> None:
    if not mc.bucket_exists(bucket):
        mc.make_bucket(bucket)
    count = size = 0
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as tar:
        for member in tar:
            if not member.isfile():
                continue
            content_type = member.pax_headers.get(CONTENT_TYPE, "application/octet-stream")
            mc.put_object(bucket, member.name, tar.extractfile(member), member.size, content_type=content_type)
            count += 1
            size += member.size
    print(f"imported {count} objects, {size / 1e6:.1f} MB", file=sys.stderr)


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("export", "import"):
        print(__doc__, file=sys.stderr)
        return 2
    bucket = os.environ.get("MINIO_BUCKET", "aureum")
    (export if sys.argv[1] == "export" else restore)(client(), bucket)
    return 0


if __name__ == "__main__":
    sys.exit(main())
