#!/bin/sh
set -eu

if [ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/incidentatlas.btcpay.exchange" ]; then
    /usr/bin/systemctl reload nginx
fi
