#!/usr/bin/env bash

set -e

# api virou api-blue/api-green (blue-green de produção); localmente só
# precisamos da infra (postgres/redis/etc.) de pé, a API roda via `npm run
# start` logo abaixo.
if [ "$(docker compose ps -q api-blue | wc -l)" -eq 0 ]; then
    docker compose up -d
elif [ "$(docker compose ps --status running -q api-blue | wc -l)" -eq 0 ]; then
    docker compose start
fi

npm run start