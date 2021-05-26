# protobuf build
FROM node:14-buster-slim as builder
WORKDIR /usr/src
COPY messages .
RUN yarn install && yarn proto

# we are rebuilding on each deploy to cope with the PUSHER_URL environment URL
FROM thecodingmachine/nodejs:14-apache

COPY --chown=docker:docker front .
COPY --from=builder --chown=docker:docker /var/www/messages/generated /var/www/html/src/Messages/generated

# Removing the iframe.html file from the final image as this adds a XSS attack.
# iframe.html is only in dev mode to circumvent a limitation
RUN rm dist/iframe.html

RUN yarn install

COPY front .
COPY --from=builder /usr/src/generated src/Messages/generated
ENV NODE_ENV=production

ARG ADMIN_URL=admin.$BASE_DOMAIN
ARG API_URL=pusher.$BASE_DOMAIN
ARG BASE_DOMAIN=workadventure.localhost
ARG JITSI_PRIVATE_MODE
ARG JITSI_URL
ARG START_ROOM_URL
ARG STUN_SERVER
ARG TURN_PASSWORD
ARG TURN_SERVER
ARG TURN_USER
ARG UPLOADER_URL=uploader.$BASE_DOMAIN

RUN ./templater.sh
RUN API_URL=$API_URL UPLOADER_URL=$UPLOADER_URL ADMIN_URL=$ADMIN_URL START_ROOM_URL=$START_ROOM_URL \
    JITSI_URL=$JITSI_URL JITSI_PRIVATE_MODE=$JITSI_PRIVATE_MODE \
    STUN_SERVER=$STUN_SERVER TURN_SERVER=$TURN_SERVER TURN_USER=$TURN_USER TURN_PASSWORD=$TURN_PASSWORD \
    yarn run build

# final production image
FROM nginx:mainline-alpine
COPY front/nginx-vhost.conf /etc/nginx/conf.d/default.conf
COPY --from=builder2 /usr/src/dist /usr/share/nginx/html
