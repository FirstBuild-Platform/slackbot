# slackbot
Slackbot for LM Platform integration

Currently, run as a Docker container on master-d.

# Build

Login to master-d and `sudo bash`.

Run `/mnt/bots/build_slackbot_docker.sh`.

# Run

This will kill any running Slackbot container and restart it.

Run `/mnt/bots/run_slack_bot.sh`

# Service Location

Presently, serving through an ELB via https://slackbot.localmotors.com

# View Client ID and Client Secret at:

https://api.slack.com/apps/A1NUZPURZ/oauth
