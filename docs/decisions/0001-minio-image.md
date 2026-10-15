# 0001 — MinIO container image

- **Status:** accepted
- **Date:** 2026-10-15

## Context

The stack uses MinIO as S3-compatible storage for avatars, banners and attachments.
MinIO Inc. stopped publishing community container images: `minio/minio` is no longer
available on Docker Hub, and `quay.io/minio/minio` is gone as well.

## Decision

Use `pgsty/minio`, a community-maintained fork of MinIO published by the Pigsty project.
It ships the same S3 API, keeps the same CLI and environment variables, and provides
both amd64 and arm64 images (arm64 is required for the Oracle Cloud Ampere A1 VM).
The tag is pinned to a specific release.

## Alternatives considered

- **SeaweedFS** (Apache 2.0, official image): viable, but it would mean a different
  product from the planned stack.
- **Building MinIO from source**: official code, but slower builds and manual upkeep.

## Consequences

The API talks to it through the S3 protocol (boto3), so switching to SeaweedFS
or another S3-compatible server later only requires changing the compose service and
the `.env` values.
