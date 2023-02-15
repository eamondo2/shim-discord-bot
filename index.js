import mpv from "node-mpv";
import fs from "fs";
import got from "got";
import ytdl from "ytdl-core";
import {ActivityType, Client, Events, GatewayIntentBits, IntentsBitField, EmbedBuilder, TextChannel, Colors} from "discord.js";
import { Message } from "discord.js";
import { Embed } from "discord.js";

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

//Array of created embed objects. Index values match queue position of video.
/** @type {[{queue_pos: number, message_sent: boolean, embed: Embed}]} */
let currentBotQueue = [];
//Stash processed links, post-scrape and embed creation
/** @type {[string]} */
let processedLinkList = [];
//Stash message IDs for already-sent queue entries.
/** @type {[Message]} */
let queueMessageList = [];

/** @type {Message} */
let currentControlMessage = null;

/** @type {TextChannel} */
let channel = null;

/**
 * ===================================
 * Helper functions
 * ===================================
 */



async function cleanupChannel() {
    console.log('cleanup start');
    let cleanupPool = [];
    for (let messageObj of await channel.messages.fetch()) {
        let message = messageObj[1];
        console.log(`Deleting message from ${message.author.avatar}\n${message.content}`);
        cleanupPool.push(message.delete());
    }

    await Promise.all(cleanupPool);

    console.log('cleanup end');
}

async function validateYtThumbnailUrl(video_id) {
    let maxres_default = `https://i.ytimg.com/vi/${video_id}/maxresdefault.jpg`;
    let hq_default = `https://i.ytimg.com/vi/${video_id}/hqdefault.jpg`;
    let ytResponse;
    try {
        ytResponse = await got({
            url: maxres_default,
        });
        return maxres_default;
    } catch (e) {
        //somehow the url is not valid.
        console.error(`Unable to fetch maxresdefault thumbnail for ${video_id}\n${e}`);
    }
    try {
        ytResponse = await got({
            url: hq_default
        });
        return hq_default;
    } catch (e) {
        console.error(`Unable to fetch hqdefault thumbnail for ${video_id}\n${e}`);
    }
    return null;
}

function grabYtVideoID(video_url) {
    //Big nasty regex because why not
    const regex = /(https:\/\/)(www\.)?(((youtube\.com\/)|(youtu\.be\/)){1})((watch\?v=)|(shorts\/))?([a-zA-Z0-9_]*)((\?[a-z]=\d*)|(\?[a-z]*=[a-z]*))?/gm;
    let m = regex.exec(video_url);
    if (m && m.length >= 10) {
        return m[10];
    }
    return null;

}

function createQueueEntryEmbed(thumbnail_link, video_url, video_title, video_author, queue_pos) {
    console.log(queue_pos);
    let newEmbed = new EmbedBuilder()
        .setTitle(`${video_author} - ${video_title}`)
        .setColor(queue_pos <= 1 ? Colors.DarkRed : Colors.DarkAqua)
        .setURL(video_url)
        .setThumbnail(thumbnail_link)
        .setImage(thumbnail_link);
    
    return {queue_pos, message_sent: false, embed: newEmbed};

}

async function processLink(url) {

    let ytdlInfo = await ytdl.getBasicInfo(url);
    let author = ytdlInfo.videoDetails.author.name;
    let title = ytdlInfo.videoDetails.title;
    let queue_pos = currentBotQueue.length + 1;
    let thumbnail_link = await validateYtThumbnailUrl(grabYtVideoID(url));
    if (!thumbnail_link) {
        console.error(`Cannot get thumbnail, skipping for video ${url}`);
    }

    currentBotQueue.push(createQueueEntryEmbed(thumbnail_link, url, title, author, queue_pos));



    processedLinkList.push(url);
}   

async function sendQueueMessage() {
    
    for (let pendingSent of currentBotQueue) {
        if (pendingSent.message_sent) continue;
        pendingSent.message_sent = true;
        let sendMessageResponse = await channel.send({
            embeds: [pendingSent.embed]
        });

        queueMessageList.push(sendMessageResponse);

    }
}

async function updateControlMessage() {
    if (queueMessageList.length <= 0) {
        console.log('No queue items to attach controls to');
        //TODO: create dummy message just to have controls
        return;
    }

    let newControlMessage = queueMessageList[queueMessageList.length - 1];
    
    let pool = [];

    for (let message of queueMessageList) {
        if (message.id !== newControlMessage) {
            pool.push(message.reactions.removeAll());
        }
    }

    for (let reaction of defaultControlList) {
        pool.push(newControlMessage.react(reaction));
    }

    await Promise.all(pool);

    currentControlMessage = newControlMessage;

}

async function updateQueueIndex(queue_pos_new, queue_pos_old) {
    console.log(queue_pos_new, queue_pos_old);
    if (currentBotQueue.length <= 1) return;
    let pool = [];
    
    let new_pos_embed = queueMessageList[queue_pos_new].embeds[0];
    new_pos_embed = EmbedBuilder.from(new_pos_embed).setColor(Colors.DarkRed);
    let old_pos_embed = queueMessageList[queue_pos_old].embeds[0];
    old_pos_embed = EmbedBuilder.from(old_pos_embed).setColor(Colors.DarkAqua);
       
    pool.push(
        queueMessageList[queue_pos_new].edit(
            {
                embeds: [
                    new_pos_embed
                ]
            }
        )
    );
    
    pool.push(
        queueMessageList[queue_pos_old].edit(
            {
                embeds: [
                    old_pos_embed
                ]
            }
        )
    );

    let results = await Promise.all(pool);
    console.log(results);

}

async function addToQueue(url) {
    mpvPlayer.load(url, "append-play");
    await processLink(url);
    await sendQueueMessage();
    await updateControlMessage();
}

/**
 * ===================================
 * MPV Player events/handling
 * ===================================
 */
let mpvPlayer;
let mpvOpts = {
    verbose: false,
    debug: false,
    audio_only: false
};
if (process.platform === "win32") {
    mpvPlayer = new mpv(
    Object.assign(mpvOpts, {binary: "./mpv/mpv.exe"}),
    [
        "--force-window=immediate",
        "--keep-open=yes",
        "--config-dir=./mpv/portable_config"
    ]
    );
} else {
    mpvPlayer = new mpv(mpvOpts,
    [
        "--force-window=immediate",
        "--keep-open=yes",
        "--config-dir=./mpv/portable_config"
    ]
    );
}

let playerStatusObject = {};

let cur_playlist_pos, old_playlist_pos;

mpvPlayer.on('statuschange', async (data) => {
    // console.log(data);
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
            case "property-change": 

                switch(data.name) {
                    case "playlist-pos":
                        console.log(data);
                        old_playlist_pos = cur_playlist_pos;
                        cur_playlist_pos = data.data;
                        await updateQueueIndex(cur_playlist_pos, old_playlist_pos);
                        break;        
                    default:
                        break;
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
    channel = await client.channels.fetch(conf.CHANNEL_ID);
    //Initial channel cleanup, purge old control message.
    await cleanupChannel();
    
});

//Listen for messages, trigger queue change and player queue additions
client.on(Events.MessageCreate, async (message) => {
    if (message.author.id === client.user.id) return;
    if (message.channelId === conf.CHANNEL_ID) {
        console.log("message received");
        console.log(message.content);
        if (ytdl.validateURL(message.content)) {
            await Promise.all([
                addToQueue(message.content),
                message.delete()
            ]);

        }
    }
});

//Listen for reactions, trigger controls.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    //Whoopsie
    if (reaction.message.channelId !== conf.CHANNEL_ID) return;
    if (user.id === client.user.id) return;
    if (reaction.message.id !== queueMessageList[queueMessageList.length - 1].id) return;

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
                processedLinkList = [];
                queueMessageList = [];
                currentControlMessage = null;
                cleanupChannel();

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