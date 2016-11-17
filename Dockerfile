FROM ubuntu:16.04
RUN apt-get update
RUN apt-get install -y nodejs git npm
RUN mkdir /mnt/slackbot && mkdir /mnt/slackbot/slack_bot_storage
ADD slack_bot.js /mnt/slackbot/
ADD package.json /mnt/slackbot/
VOLUME /mnt/slackbot/slack_bot_storage
ARG port
EXPOSE $port
ENV clientId override_this
ENV clientSecret override_this
ENV port $port
WORKDIR /mnt/slackbot
RUN /usr/bin/npm install
ENTRYPOINT ["/usr/bin/nodejs", "slack_bot.js"]
