import mpv from "node-mpv";
import fs from "fs";
import {ActivityType, Client, Events, GatewayIntentBits, IntentsBitField} from "discord.js";

const conf = JSON.parse(fs.readFileSync("config.json"));
const token = JSON.parse(fs.readFileSync("bot-token.json")).token;

const defaultControlList = [
    '⏯', '⏹️', '⏮️', '⏭️', 
]

const controlsEnum = {
    '⏯': 'play-pause',
    '⏹️': 'stop',
    '⏮️': 'previous',
    '⏭️': 'next'
};

let currentBotQueue = [];

let oldControlMessage;

/**
 * ===================================
 * Helper functions
 * ===================================
 */

function isYTLink(url) {
    if (url.indexOf("youtu.be") > 0) return true;
    if (url.indexOf("youtube.com") > 0) return true;
    if (url.startsWith("https://youtu.be") || url.startsWith("https://youtube.com")){
        return true;
    }
    return false;
}

async function cleanupChannel() {
    console.log('cleanup start');

    let monitorChannel = await client.channels.fetch(conf.CHANNEL_ID);
    
    for (let messageObj of await monitorChannel.messages.fetch()) {
        let message = messageObj[1];
        console.log(message.author.id);
        console.log(message.content);
        if (message.author.id !== client.user.id) {
            await monitorChannel.messages.delete(message);
        } else {
            if (!oldControlMessage || message.id !== oldControlMessage.id) {
                await monitorChannel.messages.delete(message);
            }
        }

    }
    
    console.log('cleanup end');
}

async function createControlMessage() {
    let channel = await client.channels.fetch(conf.CHANNEL_ID);
    if (oldControlMessage) {
        await channel.messages.delete(oldControlMessage.id);
    }
    let messageContent = {
        content: 'Bot Control Message:\n'
    };
    for (let queueEntry of currentBotQueue) {
        messageContent.content += (`\n${queueEntry}`);
    }
    let message = await channel.send(messageContent);

    oldControlMessage = message;

    for (let reaction of defaultControlList) {
        await message.react(reaction);
    }
}




/**
 * ===================================
 * MPV Player events/handling
 * ===================================
 */
let mpvPlayer = new mpv({
    verbose: true,
    debug: true,
    audio_only: false,
    binary: "./mpv/mpv.exe",
},
[
    "--force-window=immediate",
    "--keep-open=yes"
]
);

let playerStatusObject = {};

mpvPlayer.on('statuschange', async (data) => {
    console.log(data);
    playerStatusObject = data;
});

mpvPlayer.socket.on('message', async (data) => {
    if (data.hasOwnProperty("event")) {
        switch (data.event) {
            //Catch hitting "next" or "previous" while player is paused, and start playback once video is loaded.
            case "playback-restart":
                if (playerStatusObject && playerStatusObject.pause) {
                    mpvPlayer.resume();
                }
                break;
            default:
                break;
        }
    }

}); 


/**
 * ==================================
 * discord.js client events/handling
 * ==================================
 */

const client = new Client({
    intents: [GatewayIntentBits.Guilds, IntentsBitField.Flags.GuildMessages, IntentsBitField.Flags.MessageContent, IntentsBitField.Flags.GuildMessageReactions],
    presence: {
        status: "online",
        activities: [
            {
                name: "for YT links",
                type: ActivityType.Watching,

            }
        ]
    }
});

client.once(Events.ClientReady, async c => {
    console.log(`Ready, logged in as ${c.user.tag}`);
    //Initial channel cleanup, purge old control message.
    await cleanupChannel();
    
});

//Listen for messages, trigger queue change and player queue additions
client.on(Events.MessageCreate, async (message) => {
    if (message.author.id === client.user.id) return;
    if (message.channelId === conf.CHANNEL_ID) {
        console.log("message received");
        console.log(message.content);
        if (isYTLink(message.content)) {
            mpvPlayer.load(message.content, "append-play");
            currentBotQueue.push(message.content);
        }

        await message.delete();
        
        await createControlMessage();
        
        
    }
});

//Listen for reactions, trigger controls.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.id === client.user.id) return;
    let emoji;
    if (emoji = Object.keys(controlsEnum).find((value, idx) => {
        if (value === reaction.emoji.name) return true;
    })) {
        switch (controlsEnum[emoji]){
            case 'play-pause': 
                mpvPlayer.togglePause();
                break;
            case 'stop':
                mpvPlayer.stop();
                currentBotQueue = [];
                await createControlMessage();
                return;
            case 'previous':
                mpvPlayer.prev();
                break;
            case 'next':
                mpvPlayer.next();
                break;
            default:
                console.log('no valid command found');
                break;
        }
    }

    reaction.users.remove(user);

})


client.login(token);