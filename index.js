import mpv from "node-mpv";
import got from "got";
import fs from "fs";
import {ActivityType, Client, Events, GatewayIntentBits, IntentsBitField} from "discord.js";


const conf = JSON.parse(fs.readFileSync("config.json"));

const defaultControlList = [
    '⏯', '⏹️', '⏮️', '⏭️', 
]

const controlsEnum = {
    '⏯': 'play-pause',
    '⏹️': 'stop',
    '⏮️': 'previous',
    '⏭️': 'next'
};

function isYTLink(url) {
    if (url.indexOf("youtu.be") > 0) return true;
    if (url.indexOf("youtube.com") > 0) return true;
    if (url.startsWith("https://youtu.be") || url.startsWith("https://youtube.com")){
        return true;
    }
    return false;
}

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


let currentBotQueue = [];

let oldControlMessage;


client.once(Events.ClientReady, async c => {
    console.log(`Ready, logged in as ${c.user.tag}`);
    await cleanupChannel();
    
});

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

async function purgeMessages() {
    let monitorChannel = await client.channels.fetch(conf.CHANNEL_ID);
    let filterFunc = m => m.author.id !== client.user.id;
    let messageCollector = monitorChannel.createMessageCollector({filter: filterFunc, time: 15_000 });
    let purgeQueue = [];
    messageCollector.on('collect', m => {
        console.log(`collected: ${m.content} author: ${m.author.id}`);
    });
    messageCollector.on('end', async collected => {
        console.log(`collected ${collected.size} items`);
        purgeQueue.concat(collected);
    });
    console.log(purgeQueue);
    await monitorChannel.bulkDelete(purgeQueue);

}

mpvPlayer.on('statuschange', async (data) => {
    console.log(data);
});

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
                break;
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

let token = JSON.parse(fs.readFileSync("bot-token.json")).token;

client.login(token);