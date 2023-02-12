/*
Go here: https://discord.com/developers/applications
-> New Application
-> Bot
-> Add Bot
Copy the token, goes in config.js as BOT_TOKEN
-> OAuth2
-> URL Generator
check 'bot'
check required permissions
Go to URL at bottom, select appropriate discord server

In Discord
-> Settings
-> Advanced (under App Settings)
-> Developer Mode (checked)
Go to server
-> Right click channel
-> Copy ID
Goes in config.js as CHANNEL_ID
*/
const eris = require('eris');
const { BOT_TOKEN, CHANNEL_ID } = require('./config.json');

// Create a Client instance with our bot token.
const bot = new eris.Client(BOT_TOKEN);
let channel;

// When the bot is connected and ready, log to console.
bot.once('ready', () => {
    console.log('Connected and ready.');
    channel = bot.getChannel(CHANNEL_ID);
    channel.createMessage('bot live');
});

bot.on('error', err => {
    console.warn(err);
});

bot.on('messageCreate', async (msg) => {
    if (isYoutube(msg.content)) {
        // post to mpv? https://github.com/rcombs/node-mpv maybe?
        // https://github.com/mpv-player/mpv/wiki/Language-bindings wiki
        channel.createMessage('youtube');
    }
});

const isYoutube = (url) => {
    return url.startsWith('https://youtu.be');
}

bot.connect();
