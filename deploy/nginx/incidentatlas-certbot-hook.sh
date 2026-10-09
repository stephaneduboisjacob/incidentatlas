#!/bin/sh
set -eu

if [ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/incidentatlas.example.com" ]; then
    /usr/bin/systemctl reload nginx
fi
