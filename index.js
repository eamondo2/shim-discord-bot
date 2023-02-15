import mpv from "node-mpv";
import fs from "fs";
import got from "got";
import ytdl from "ytdl-core";
import {ActivityType, Client, Events, GatewayIntentBits, IntentsBitField, EmbedBuilder, TextChannel, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageComponentInteraction, ActionRow, Emoji} from "discord.js";
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
/** @type {[{queue_pos: number, message_sent: boolean, embed: Embed, actionRow: ActionRow}]} */
let currentBotQueue = [];
//Stash processed links, post-scrape and embed creation
/** @type {[string]} */
let processedLinkList = [];
//Stash message IDs for already-sent queue entries.
/** @type {[Message]} */
let queueMessageList = [];

/** @type {Message} */
let currentControlMessage = null;

/** @type {{queue_pos: number, message_sent: boolean, embed: Embed, actionRow: ActionRow}} */
let currentEmbedObj = null;

/** @type {TextChannel} */
let channel = null;


let playerStatusObject = {};

let cur_playlist_pos, old_playlist_pos;

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

function createActionRow(queue_pos, is_control_message = false) {
    let actionRow;
    console.log(queue_pos, cur_playlist_pos, is_control_message);
    if (is_control_message) {
        actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${queue_pos}-playpause`)
                    .setEmoji('⏯')
                    .setStyle(ButtonStyle.Primary)
            )
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${queue_pos}-stop`)
                    .setEmoji('⏹️')
                    .setStyle(ButtonStyle.Primary)
            )
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${queue_pos}-prev`)
                    .setEmoji('⏮️')
                    .setStyle(ButtonStyle.Primary)
            )
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${queue_pos}-next`)
                    .setEmoji('⏭️')
                    .setStyle(ButtonStyle.Primary)
            );
            if (cur_playlist_pos !== queue_pos) {

                actionRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${queue_pos}-jumphere`)
                        .setLabel('Jump')
                        .setStyle(ButtonStyle.Primary)
                )
            }
    } else if (cur_playlist_pos !== queue_pos) {
        actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${queue_pos}-jumphere`)
                    .setLabel('Jump')
                    .setStyle(ButtonStyle.Primary)
            )
            
    }

    console.log(actionRow);

    return actionRow;
       
}

function createQueueEntryEmbed(thumbnail_link, video_url, video_title, video_author, queue_pos) {

    let actionRow = createActionRow(queue_pos, queue_pos == playerStatusObject['playlist-count'] - 1);

    let newEmbed = new EmbedBuilder()
        .setTitle(`${video_author} - ${video_title}`)
        .setColor(queue_pos < 1 ? Colors.DarkRed : Colors.DarkAqua)
        .setURL(video_url)
        .setThumbnail(thumbnail_link)
        .setImage(thumbnail_link);
    

    return {queue_pos, message_sent: false, embed: newEmbed, actionRow};

}

async function processLink(url) {

    let ytdlInfo = await ytdl.getBasicInfo(url);
    let author = ytdlInfo.videoDetails.author.name;
    let title = ytdlInfo.videoDetails.title;
    let queue_pos = currentBotQueue.length;
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
        let sendMessageResponse;
        if (pendingSent.actionRow) {
            sendMessageResponse = await channel.send({
                embeds: [pendingSent.embed],
                components: [pendingSent.actionRow]
            });
        } else {
            sendMessageResponse = await channel.send({
                embeds: [pendingSent.embed]
            });
        }

        queueMessageList.push(sendMessageResponse);
        if (queueMessageList.length == 1) {
            currentControlMessage = sendMessageResponse;
            currentEmbedObj = pendingSent;
        }
    }

}

async function updateControlMessage() {
    if (queueMessageList.length <= 1) {
        console.log('No queue items to attach controls to');
        //TODO: create dummy message just to have controls
        return;
    }


    let newControlMessage = queueMessageList[queueMessageList.length - 1];
    let newEmbedObj = currentBotQueue[currentBotQueue.length - 1];

    let pool = [];
    let new_pos_embed = newControlMessage.embeds[0];
    let new_pos_actionRow = createActionRow(newEmbedObj.queue_pos, true);

    let old_pos_embed = currentControlMessage.embeds[0];
    let old_pos_actionRow = createActionRow(currentEmbedObj.queue_pos, false);
    
    if (new_pos_actionRow) {
        pool.push(
            newControlMessage.edit(
                {
                    embeds: [
                        new_pos_embed
                    ],
                    components: [
                        new_pos_actionRow
                    ]
                }
            )
        );
    } else {
        pool.push(
            newControlMessage.edit(
                {
                    embeds: [
                        new_pos_embed
                    ]
                }
            )
        );

    }
    if (old_pos_actionRow) {
        pool.push(
            currentControlMessage.edit(
                {
                    embeds: [
                        old_pos_embed
                    ],
                    components: [
                        old_pos_actionRow
                    ]
                }
            )
        );
    } else {
        pool.push(
            currentControlMessage.edit(
                {
                    embeds: [
                        old_pos_embed
                    ],
                    components: []
                }
            )
        );
    }

    currentControlMessage = newControlMessage;
    currentEmbedObj = newEmbedObj;

    let results = await Promise.all(pool);
    
    return;

}

async function updateQueueIndex(queue_pos_new, queue_pos_old) {
    if (currentBotQueue.length <= 1) return;
    let pool = [];
    
    let new_pos_embed = queueMessageList[queue_pos_new].embeds[0];
    let new_pos_actionRow = createActionRow(queue_pos_new, queue_pos_new === cur_playlist_pos && queue_pos_new === playerStatusObject['playlist-count']-1);
    new_pos_embed = EmbedBuilder.from(new_pos_embed).setColor(Colors.DarkRed);

    let old_pos_embed = queueMessageList[queue_pos_old].embeds[0];
    let old_pos_actionRow = createActionRow(queue_pos_old, queue_pos_old === playerStatusObject['playlist-count'] - 1);
    old_pos_embed = EmbedBuilder.from(old_pos_embed).setColor(Colors.DarkAqua);
    
    if (new_pos_actionRow) {

        pool.push(
            queueMessageList[queue_pos_new].edit(
                {
                    embeds: [
                        new_pos_embed
                    ],
                    components: [
                        new_pos_actionRow
                    ]
                }
            )
        );
    } else {
        pool.push(
            queueMessageList[queue_pos_new].edit(
                {
                    embeds: [
                        new_pos_embed
                    ],
                    components: []
                }
            )
        );

    }
    

    if (old_pos_actionRow) {

        pool.push(
            queueMessageList[queue_pos_old].edit(
                {
                    embeds: [
                        old_pos_embed
                    ],
                    components: [
                        old_pos_actionRow
                    ]
                }
            )
        );
    } else {
        pool.push(
            queueMessageList[queue_pos_old].edit(
                {
                    embeds: [
                        old_pos_embed
                    ],
                    components: []
                }
            )
        );
    }

    let results = await Promise.all(pool);

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
    verbose: true,
    debug: true,
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

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    
    interaction.reply({
        ephemeral: true,
        content: "Paused"
        
    }).then(() => {
        setTimeout( () => interaction.deleteReply(), 250);
    });

    let controlIDParts = interaction.customId.split('-');
    let queue_pos = Number.parseInt(controlIDParts[0]);
    let control_command = controlIDParts[1];

    switch (control_command) {
    case 'playpause': 
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
    case 'prev':
        mpvPlayer.prev();
        break;
    case 'next':
        mpvPlayer.next();
        break;
    case 'jumphere': 
        //TODO: handle queue position jump
        if (queue_pos <= currentBotQueue.length - 1) {
            console.log(queue_pos);
            mpvPlayer.socket.command("playlist-play-index", [queue_pos]);
        } else {
            console.error("Invalid queue position");
        }
        break;
    default:
        console.log('no valid command found');
        break;
    }

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