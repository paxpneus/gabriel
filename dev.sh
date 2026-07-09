#!/usr/bin/env bash

set -e

if [ "$(docker compose ps -q api | wc -l)" -eq 0 ]; then
    docker compose up -d
elif [ "$(docker compose ps --status running -q api | wc -l)" -eq 0 ]; then
    docker compose start
fi

npm run start