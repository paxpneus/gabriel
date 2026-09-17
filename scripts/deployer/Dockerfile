# Imagem do serviço `deployer`: fala com o Docker do host via docker.sock
# (docker-outside-of-docker) pra buildar/subir/derrubar os containers do
# blue-green, disparado pelo webhook do GitHub.
FROM docker:27-cli

RUN apk add --no-cache \
    bash \
    git \
    nodejs \
    docker-cli-compose \
    util-linux

WORKDIR /app
COPY webhook.js ./webhook.js
COPY deploy.sh /usr/local/bin/deploy.sh
RUN chmod +x /usr/local/bin/deploy.sh

CMD ["node", "/app/webhook.js"]
