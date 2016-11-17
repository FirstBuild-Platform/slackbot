var Botkit = require('botkit');
var request = require('request');
var Keen = require('keen-js');
var raven = require('raven');
var client = new raven.Client('https://<sentrykey>:<sentryanotherkey>@app.getsentry.com/20972');
client.patchGlobal();

var IQ_AWARD_URL = 'https://cocreate.localmotors.com/api/v2/iq/',
    ACTIVITY_STREAM_URL = 'https://slack2.lm-dev.com/api/v2/slack_activity/',
    LINK_ACCOUNT_URL = 'https://slack2.lm-dev.com/account/#connections',
    MAX_POINTS = 5,
    MIN_POINTS = 1;

var bot = null,
    controller = null;

var keen = new Keen({
    projectId: '<keenprojectid>',
    writeKey: '<keenwritekey>'
});

// bot token
if (process.env.token) {

    controller = Botkit.slackbot({
        json_file_store: './slack_bot_storage/',
        debug: true,
    });

    bot = controller.spawn({
        token: process.env.token
    }).startRTM();

// app
} else if (process.env.clientId && process.env.clientSecret && process.env.port) {

    controller = Botkit.slackbot({
        json_file_store: './slack_bot_storage/',
        debug: true
    }).configureSlackApp({
        clientId: process.env.clientId,
        clientSecret: process.env.clientSecret,
        // scopes: ['commands', 'bot', 'incoming-webhook','team:read','users:read','channels:read','channels:history','im:read','im:write','groups:read','emoji:read','chat:write:bot']
        scopes: ['commands', 'bot', 'incoming-webhook', 'channels:history']
    });

    controller.setupWebserver(process.env.port, function(err, webserver) {

        webserver.post('/link_account', function(req, res) {
            var platformID = req.body.platform_id,
                platformUsername = req.body.platform_username,
                slackID = req.body.slack_id,
                teamID = req.body.team_id,
                slackUsername = req.body.slack_username,
                isAdmin = req.body.is_admin === 'True' ? true : false,
                isStaff = req.body.is_staff;

                controller.storage.users.get(slackID, function(err, user_data) {

                    var user = {};

                    if (err) {

                        user = {
                            id: slackID,
                            platform_id: platformID,
                            platform_username: platformUsername,
                            slack_username: slackUsername,
                            is_admin: isAdmin,
                            is_staff: isStaff,
                            team_id: teamID
                        };

                        client.captureMessage('no user');
                        controller.storage.users.save(user);

                    } else {

                        client.captureMessage(user_data);

                        user_data.platform_id = platformID;
                        user_data.platform_username = platformUsername;
                        user_data.slack_username = slackUsername;
                        user_data.is_admin = isAdmin;
                        user_data.is_staff = isStaff;
                        user_data.team_id = teamID;

                        controller.storage.users.save(user_data);
                    }

                });

                res.send('Platform ID:' + platformID + ' Slack ID: ' + slackID);
            });
        });

        controller.createWebhookEndpoints(controller.webserver);

        controller.createOauthEndpoints(controller.webserver,function(err, req, res) {

        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            res.send('Success!');
        }
    });

} else {
    client.captureMessage('Error: Specify clientId clientSecret and port in environment');
    process.exit(1);
}


// don't connect to the RTM twice for the same team
var _bots = {};
function trackBot(bot) {
    _bots[bot.config.token] = bot;
}

// send IQ: Awarded event to keen
function sendEvent(points, user, awarded_by, text, project, bot, message) {

    points = parseInt(points, 10);

    if (points > MAX_POINTS) {
        points = MAX_POINTS;

    } else if (points < MIN_POINTS) {
        points = MIN_POINTS;
    }

    client.captureMessage(points, user, awarded_by, text, project);

    // get user in storage
    controller.storage.users.get(user, function(err, user) {

        client.captureMessage(user);

        if (user) {

            controller.storage.users.get(awarded_by, function(err, awarded_by_user) {

                client.captureMessage(awarded_by_user);

                if (awarded_by_user && awarded_by_user.platform_id !== user.platform_id) {

                    if (message) {
                        bot.reply(message, 'Awarded @   ' + user.slack_username + ': ' + points + ' points');
                    }

                    var data = {
                        user: user.platform_id,
                        awarded_by: awarded_by_user.platform_id,
                        points: points,
                        text: text,
                        project: project,
                        keen: {
                            timestamp: new Date().toISOString()
                        }
                    };

                    keen.addEvent('IQ: Awarded', data, function(err, res) {
                        if (err) {

                        } else {

                        }
                    });
                }
            });
        }
    });
}


controller.on('create_bot',function(bot,config) {

    // already online
    if (_bots[bot.config.token]) {

    } else {

        bot.startRTM(function(err) {

            if (!err) {
                trackBot(bot);
            }

            bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
                if (err) {
                    client.captureMessage(err);

                } else {
                    convo.say('/invite me to a channel you wish to award points on' + bot.config.token);
                }
            });
        });
    }
});

controller.on('reaction_added', function(bot, event) {

    var reaction = event.reaction;

    client.captureMessage(event);

    // TODO: The token given to the bot user is missing channels:read scope
    // but the OAUTH flow is authorizing channels:read as configured in configureSlackApp:
    // scopes: ['commands', 'bot', 'incoming-webhook', 'channels:history']
    bot.config.token = '<bot-token>';
    bot.config.bot.token = '<bot-token>';

    // get reacted to message in channel
    bot.api.channels.history({
        channel: event.item.channel,
        latest: event.item.ts,
        count: 1,
        inclusive: 1

    }, function(err, response) {
        client.captureMessage(response);


        if (response && response.ok) {

            // get message user in storage
            controller.storage.users.get(event.item_user, function(err, awarded_user) {

                // get awarded by user in storage
                controller.storage.users.get(event.user, function(err, awarded_by_user) {

                    if (awarded_by_user) {

                        client.captureMessage(awarded_user);

                        if (awarded_user) {

                            // get points value (event.reaction)
                            var points = 0;

                            switch (event.reaction) {

                                case '1_iq_points':
                                    points = 1;
                                    break;
                                case '2_iq_points':
                                    points = 2;
                                    break;
                                case '3_iq_points':
                                    points = 3;
                                    break;
                                case '4_iq_points':
                                    points = 4;
                                    break;
                                case '5_iq_points':
                                    points = 5;
                                    break;
                            }

                            if (points > 0) {

                                var msg = response.messages[0],
                                    text = '@' + awarded_by_user.slack_username + ' gave @' + awarded_user.slack_username + ' :' + points + '_iq_points: IQ points for a comment';

                                // post public reply in channel
                                bot.api.chat.postMessage({
                                    timestamp: event.item.ts,
                                    channel: event.item.channel,
                                    text: text,
                                });

                                var data = {
                                    team_id: awarded_user.team_id ? awarded_user.team_id : '',
                                    team_domain: '',
                                    channel_id: event.item.channel,

                                    // awarded user
                                    slack_id: awarded_user.id,
                                    slack_username: awarded_user.slack_username,
                                    platform_id: awarded_user.platform_id,
                                    platform_username: awarded_user.platform_username,

                                    // awarded by user
                                    awarded_by_slack_id: awarded_by_user.id,
                                    awarded_by_slack_username: awarded_by_user.slack_username,
                                    awarded_by_platform_id: awarded_by_user.platform_id,
                                    awarded_by_platform_username: awarded_by_user.platform_username,

                                    text: msg.text,
                                    points: points,
                                    project: 99,

                                    keen: {
                                        timestamp: new Date().toISOString()
                                    }
                                };

                                keen.addEvent('IQ: Awarded', data, function(err, res) {
                                    if (err) {

                                    } else {

                                    }
                                });

                                request({
                                    uri: ACTIVITY_STREAM_URL,
                                    method: 'POST',
                                    form: {

                                        slack_id: awarded_user.id,
                                        slack_username: awarded_user.slack_username,
                                        platform_id: awarded_user.platform_id,
                                        platform_username: awarded_user.platform_username,

                                        // awarded by user
                                        awarded_by_slack_id: awarded_by_user.id,
                                        awarded_by_slack_username: awarded_by_user.slack_username,
                                        awarded_by_platform_id: awarded_by_user.platform_id,
                                        awarded_by_platform_username: awarded_by_user.platform_username,

                                        text: msg.text,
                                        points: points,
                                        project: 99
                                    }

                                }, function(error, response, body) {

                                    client.captureMessage(error, response, body);
                                });

                            }
                        }
                    }
                });
            });
        }

    });
});

controller.on('create_incoming_webhook',function(bot,webhook_config) {

    bot.sendWebhook({
        text: 'Incoming webhook successfully configured: ' + bot.config.incoming_webhook.url
    });
});

controller.on('slash_command',function(bot, message) {

    client.captureMessage(message);

    var text = message.text ? message.text : '';
        points = 0,
        username = '',
        points_int = null,
        command_components = text.split(' ');

    var command_error = {
        "text": 'Error',
        "attachments": [
            {
                "text": 'Command format invalid (@username [1-5])'
            }
        ]
    };

    // invalid command
    if (message.text === '') {
        bot.replyPrivate(message, command_error);

    // invalid command
    } else if (command_components.length < 2) {
        bot.replyPrivate(message, command_error);

    } else {

        username = command_components[0].split('@')[1] ? command_components[0].split('@')[1] : command_components[0];
        points = command_components[1];
        points_int = parseInt(points, 10);

        var points_integer_error = {
            "text": 'Error',
            "attachments": [
                {
                    "text": 'Point value ' + points + ' is not a valid number'
                }
            ]
        };

        var points_value_error = {
            "text": 'Error',
            "attachments": [
                {
                    "text": 'Point value ' + points + ' is not between 1-5'
                }
            ]
        };

        if (isNaN(points_int)) {
            bot.replyPrivate(message, points_integer_error);

        } else if (points_int < 1 || points_int > 5) {
            bot.replyPrivate(message, points_value_error);

        } else {

            // get all users
            controller.storage.users.all(function(err, all_users) {

                if (err) {
                    client.captureMessage('error', err);
                    return;
                }

                var awarded_user = all_users.find(function(n) {
                    return n.slack_username == username;
                });

                var awarded_by_user = all_users.find(function(n) {
                    return n.id == message.user_id;
                });

                client.captureMessage(awarded_user);

                client.captureMessage(awarded_by_user);


                if (!awarded_by_user) {

                    var account_not_linked_error = {
                        "text": 'Error',
                        "attachments": [
                            {
                                "text": 'Your account is not linked, visit ' + LINK_ACCOUNT_URL + ' to link your account'
                            }
                        ]
                    };

                    bot.replyPrivate(message, account_not_linked_error);

                } else if (!awarded_user) {

                    var user_not_found_error = {
                        "text": 'Error',
                        "attachments": [
                            {
                                "text": username + ' was not found or has not linked their account with slack'
                            }
                        ]
                    };

                    bot.replyPrivate(message, user_not_found_error);

                } else if (awarded_by_user.id === awarded_user.id) {

                    var self_award_error = {
                        "text": 'Error',
                        "attachments": [
                            {
                                "text": 'You cannot award points to yourself'
                            }
                        ]
                    };

                    bot.replyPrivate(message, self_award_error);

                } else if (!awarded_by_user.is_admin)  {

                    var admin_required_error = {
                        "text": 'Error',
                        "attachments": [
                            {
                                "text": 'You do have permission to award points'
                            }
                        ]
                    };

                    bot.replyPrivate(message, admin_required_error);


                } else {

                    var data = {
                        team_id: message.team_id,
                        team_domain: message.team_domain,
                        channel_id: message.channel_id,

                        // awarded user
                        slack_id: awarded_user.id,
                        slack_username: awarded_user.slack_username,
                        platform_id: awarded_user.platform_id,
                        platform_username: awarded_user.platform_username,

                        // awarded by user
                        awarded_by_slack_id: awarded_by_user.id,
                        awarded_by_slack_username: awarded_by_user.slack_username,
                        awarded_by_platform_id: awarded_by_user.platform_id,
                        awarded_by_platform_username: awarded_by_user.platform_username,

                        text: command_components.from(2).join(' '),
                        points: points_int,
                        project: 99,

                        keen: {
                            timestamp: new Date().toISOString()
                        }
                    };

                    keen.addEvent('IQ: Awarded', data, function(err, res) {
                        if (err) {

                        } else {

                        }
                    });

                    var points_awarded_success = {
                        "text": 'Points Awarded',
                        "attachments": [
                            {
                                "text": '@' + awarded_by_user.slack_username + ' gave @' + awarded_user.slack_username + ' :' + points + '_iq_points: IQ points for a comment'
                            }
                        ],
                        "response_type": "in_channel"
                    };

                    bot.replyPublic(message, points_awarded_success);
                }
            });
        }
    }
});

controller.on('team_join', function(bot, event) {

    client.captureMessage(event);

    bot.config.token = '<bot-config-token>';
    bot.config.bot.token = '<bot-config-token>';

    bot.api.team.info({}, function(err, response) {

        client.captureMessage(response);

        // send message to new user
        bot.api.chat.postMessage({
            channel: event.user.id,
            text: 'Thanks for joining the team! Visit ' + LINK_ACCOUNT_URL + ' to connect your Local Motors account so you can be awarded Influence Quotient points for your contributions. Select: ' + response.team.name + ' when linking your account'

        }, function(err, response) {

        });
    });

});


controller.on('message', function(bot, event) {

    client.captureMessage(event);
});

