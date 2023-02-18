import mpv from "node-mpv";
import fs from "fs";
import got from "got";
import ytdl from "ytdl-core";
import {ActivityType, Client, Events, GatewayIntentBits, IntentsBitField, EmbedBuilder, TextChannel, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageComponentInteraction, ActionRow, Emoji, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, ModalBuilder} from "discord.js";
import { Message, InteractionCollector, MessageCollector } from "discord.js";
import { Embed } from "discord.js";
import url from "url";
import os from "os";

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
/** @type {[{queue_pos: number, message_sent: boolean, embed: Embed, actionRowA: ActionRow, actionRowB: ActionRow}]} */
let currentBotQueue = [];
//Stash processed links, post-scrape and embed creation
/** @type {[string]} */
let processedLinkList = [];
//Stash message IDs for already-sent queue entries.
/** @type {[Message]} */
let queueMessageList = [];

/** @type {Message} */
let currentControlMessage = null;

/** @type {{queue_pos: number, message_sent: boolean, embed: Embed, actionRowA: ActionRow, actionRowB: ActionRow}} */
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
        if (message.deletable) cleanupPool.push(message.delete());
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

function parseYTVideoUrl(video_url) {
    //Big nasty regex because why not
    const regex = /(https:\/\/)(www\.)?(((youtube\.com\/)|(youtu\.be\/)){1})((watch\?v=)|(shorts\/)|(live\/))?([a-zA-Z0-9_-]*)((\?[a-z]=\d*)|(\?[a-z]*=[a-z]*)|)?(\&list=)?([a-zA-Z0-9_-]*)?/gm;
    let m = regex.exec(video_url);
    let is_playlist = false;
    let has_single_video = false;
    if (m && m.length >= 16 && m[16]) {
        is_playlist = true;
    }
    if (m && m.length >= 11 && m[11]) {
        if (is_playlist) {
            if (m[11] !== 'playlist'){
                has_single_video = true;
            }
        } else {
            return {url: `https://youtube.com/watch?v=${m[11]}`, id: m[11], is_playlist, has_single_video};
        }
        
    }

    if (is_playlist && has_single_video) {
        return {url: `https://youtube.com/watch?v=${m[11]}`, id: m[11], is_playlist, has_single_video};
    }

    if (!is_playlist && has_single_video) {
        return {url: video_url, id: m[11], is_playlist, has_single_video};
    }

    if (is_playlist && !has_single_video) {
        return {url: `https://youtube.com/playlist?list=${m[16]}`, id: m[16], is_playlist, has_single_video};
    }

    console.log(is_playlist, has_single_video);

    return null;

}

function verifyYTHost(video_url) {
    let parsed;
    try {
        parsed = url.parse(video_url);
    } catch (e) {
        console.error("Invalid url per url.parse");
        console.error(video_url, e);
        return false;
    }

    if (!parsed) return false;

    let host = parsed.host;
    let allowedHosts = [
        'youtube.com',
        'youtu.be'
    ];

    if (!allowedHosts.includes(host)) {
        return false;
    }

    return true;
}

function createSeekActionRow(queue_pos, is_control_message = false) {
    let actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`${queue_pos}-rev30`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("<==30"),
            new ButtonBuilder()
                .setCustomId(`${queue_pos}-rev15`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("<==15"),
            new ButtonBuilder()
                .setCustomId(`${queue_pos}-fwd15`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("15==>"),
            new ButtonBuilder()
                .setCustomId(`${queue_pos}-fwd30`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("30==>"),
            new ButtonBuilder()
                .setCustomId(`${queue_pos}-customseek`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("Seek Custom")
        );
    return actionRow;
}

function createActionRow(queue_pos, is_control_message = false) {
    let actionRow;
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


    return actionRow;
       
}

function createQueueEntryEmbed(thumbnail_link, video_url, video_title, video_author, queue_pos) {

    let actionRowA = createActionRow(queue_pos, queue_pos == playerStatusObject['playlist-count'] - 1);
    let actionRowB = createSeekActionRow(queue_pos, queue_pos == playerStatusObject['playlist-count'] - 1);

    let newEmbed = new EmbedBuilder()
        .setTitle(`${video_author} - ${video_title}`)
        .setColor(queue_pos < 1 ? Colors.DarkRed : Colors.DarkAqua)
        .setURL(video_url)
        .setThumbnail(thumbnail_link)
        .setImage(thumbnail_link);
    

    return {queue_pos, message_sent: false, embed: newEmbed, actionRowA, actionRowB};

}

async function processLink(url, parsed) {

    let ytdlInfo = await ytdl.getBasicInfo(url);
    let author = ytdlInfo.videoDetails.author.name;
    let title = ytdlInfo.videoDetails.title;
    let queue_pos = currentBotQueue.length;
    
    let thumbnail_link = await validateYtThumbnailUrl(parsed.id);

    if (!thumbnail_link) {
        console.error(`Cannot get thumbnail, skipping for video ${url}`);
    }

    currentBotQueue.push(createQueueEntryEmbed(thumbnail_link, parsed.url, title, author, queue_pos));



    processedLinkList.push(parsed.url);
}   

async function sendQueueMessage() {
    
    for (let pendingSent of currentBotQueue) {
        if (pendingSent.message_sent) continue;
        pendingSent.message_sent = true;
        let sendMessageResponse;
        if (pendingSent.actionRowA) {
            sendMessageResponse = await channel.send({
                embeds: [pendingSent.embed],
                components: [pendingSent.actionRowA, pendingSent.actionRowB]
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
    let new_pos_actionRowA = createActionRow(newEmbedObj.queue_pos, true);
    let new_pos_actionRowB = createSeekActionRow(newEmbedObj.queue_pos, true);

    let old_pos_embed = currentControlMessage.embeds[0];
    let old_pos_actionRowA = createActionRow(currentEmbedObj.queue_pos, false);
    let old_pos_actionRowB = createSeekActionRow(currentEmbedObj.queue_pos, false);
    
    if (new_pos_actionRowA) {
        pool.push(
            newControlMessage.edit(
                {
                    embeds: [
                        new_pos_embed
                    ],
                    components: [
                        new_pos_actionRowA,
                        new_pos_actionRowB
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
                    ],
                    components: [
                    ]
                }
            )
        );

    }
    if (old_pos_actionRowA) {
        pool.push(
            currentControlMessage.edit(
                {
                    embeds: [
                        old_pos_embed
                    ],
                    components: [
                        old_pos_actionRowA
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
                    components: [
                    ]
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
    
    let new_is_control_message = queue_pos_new === cur_playlist_pos && queue_pos_new === playerStatusObject['playlist-count']-1;
    let old_is_control_message = queue_pos_old === playerStatusObject['playlist-count'] - 1;

    console.log(old_is_control_message, new_is_control_message);

    let new_pos_embed = queueMessageList[queue_pos_new].embeds[0];
    let new_pos_actionRowA = createActionRow(queue_pos_new, queue_pos_new === cur_playlist_pos && queue_pos_new === playerStatusObject['playlist-count']-1);
    let new_pos_actionRowB = createSeekActionRow(queue_pos_new, queue_pos_new === cur_playlist_pos && queue_pos_new === playerStatusObject['playlist-count']-1);
    new_pos_embed = EmbedBuilder.from(new_pos_embed).setColor(Colors.DarkRed);

    let old_pos_embed = queueMessageList[queue_pos_old].embeds[0];
    let old_pos_actionRowA = createActionRow(queue_pos_old, queue_pos_old === playerStatusObject['playlist-count'] - 1);
    let old_pos_actionRowB = createSeekActionRow(queue_pos_old, queue_pos_old === playerStatusObject['playlist-count'] - 1);
    old_pos_embed = EmbedBuilder.from(old_pos_embed).setColor(Colors.DarkAqua);
    
    if (new_pos_actionRowA) {
        let componentArr = [
            new_pos_actionRowA
        ];
        if (new_is_control_message) componentArr.push(new_pos_actionRowB);
        pool.push(
            queueMessageList[queue_pos_new].edit(
                {
                    embeds: [
                        new_pos_embed
                    ],
                    components: componentArr
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
    

    if (old_pos_actionRowA) {

        let componentArr = [
            old_pos_actionRowA
        ];
        if (old_is_control_message) componentArr.push(old_pos_actionRowB);

        pool.push(
            queueMessageList[queue_pos_old].edit(
                {
                    embeds: [
                        old_pos_embed
                    ],
                    components: componentArr
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
                    components: [
                    ]
                }
            )
        );
    }

    let results = await Promise.all(pool);

}

async function addToQueue(url) {
    let YTVideoUrlParsed = parseYTVideoUrl(url);
    console.log(YTVideoUrlParsed);
    mpvPlayer.load(YTVideoUrlParsed.url, "append-play");
    await processLink(url, YTVideoUrlParsed);
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
                        // console.log(data);
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
    intents: [GatewayIntentBits.Guilds, IntentsBitField.Flags.GuildMessages, IntentsBitField.Flags.MessageContent],
    presence: {
        status: "online",
        activities: [
            {
                name: "for YT links",
                type: ActivityType.Watching,

            }
        ]
    },


});

let filter = i => i.channelId === conf.CHANNEL_ID;

/** @type {InteractionCollector} */
let buttonCollector;

/** @type {MessageCollector} */
let messageCollector;

client.once(Events.ClientReady, async c => {
    console.log(`Ready, logged in as ${c.user.tag}`);
    channel = await client.channels.fetch(conf.CHANNEL_ID);
    //Initial channel cleanup, purge old control message.
    await cleanupChannel();
    
    setupMessageCollector();
    setupButtonCollector();


    
});

function setupButtonCollector() {
    
    buttonCollector = channel.createMessageComponentCollector({
        filter,
        dispose: false
        
    });
    
    buttonCollector.on('end', () => {
        setupButtonCollector();
    });


    buttonCollector.on('collect', async interaction => {
        console.log(interaction);

        if (!interaction.channelId === conf.CHANNEL_ID) return;        

        let controlIDParts = interaction.customId.split('-');
        let queue_pos = Number.parseInt(controlIDParts[0]);
        let control_command = controlIDParts[1];

        try {

            if (!interaction.isModalSubmit()) {
        
                await interaction.deferReply({
                    ephemeral: true
                });
            } else {
        
                let seekVal = interaction.fields.getTextInputValue(`${queue_pos}-seekmodalinput`);
        
                let seekNumber;
                try {
                    seekNumber = Number.parseInt(seekVal);
                } catch (e) {
                    console.error("Non numeric input");
                    console.error(e);
                    await interaction.reply({
                        ephemeral: true,
                        content: "Invalid input"
                    }).then( () => {
                        setTimeout( () => interaction.deleteReply(), 10000);
                    });
        
                    return;
                }
        
                if (isNaN(seekVal)) {
                    console.error("Non numeric input");
                    await interaction.reply({
                        ephemeral: true,
                        content: "Invalid input"
                    }).then( () => {
                        setTimeout( () => interaction.deleteReply(), 10000);
                    });
        
                    return;
                }
        
                let playerCurrentTimePos = mpvPlayer.currentTimePos;
                let playerMaxTimePos = playerStatusObject.duration;
        
                if (seekNumber < 0 && playerCurrentTimePos + seekNumber < 0) {
                    //can't seek past beginning of video
                    //Set to inverse of current time index to seek to start
                    seekNumber = -playerCurrentTimePos + 10;
                }
                if (seekNumber + playerCurrentTimePos > playerMaxTimePos) {
                    //can't seek past end
                    //seek to end?
                    seekNumber = playerMaxTimePos - playerCurrentTimePos - 10;
                }
        
                mpvPlayer.seek(seekNumber);
        
                interaction.reply({
                    ephemeral: true,
                    content: "ack"
                    
                }).then(() => {
                    setTimeout( () => interaction.deleteReply(), 250);
                });
        
                return;
            }
        } catch (e) {
            console.error(e);
            return;
        }


        
        if (!interaction.isButton()) return;

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
            if (queue_pos <= currentBotQueue.length - 1) {
                mpvPlayer.socket.command("playlist-play-index", [queue_pos]);
            } else {
                console.error("Invalid queue position");
            }
            break;
        case 'rev30':
            mpvPlayer.seek(-30);
            break;
        case 'rev15':
            mpvPlayer.seek(-15);
            break;
        case 'fwd15':
            mpvPlayer.seek(15);
            break;
        case 'fwd30':
            mpvPlayer.seek(30);
            break;
        case 'customseek':
            let modal = new ModalBuilder()
                .setCustomId(`${queue_pos}-seekmodal`)
                .setTitle("Granular seek");

            let seekInput = new TextInputBuilder()
                .setCustomId(`${queue_pos}-seekmodalinput`)
                .setLabel("value as seconds, negative to seek in reverse")
                .setStyle(TextInputStyle.Short);
            
            let modalActionRow = new ActionRowBuilder().addComponents(seekInput);
            
            modal.addComponents(modalActionRow);

            interaction.showModal(modal);

            break;
        default:
            console.log('no valid command found');
            break;
        }
        let machineID = `${os.hostname}-${os.userInfo}`;
        interaction.editReply({
            content: machineID
        }).then(setTimeout(() => {interaction.deleteReply()}, 2000));
        

    });



}

function setupMessageCollector() {
    messageCollector = channel.createMessageCollector({
        filter,
        dispose: false
    });

    messageCollector.on('end', () => {
        setupMessageCollector();
    });

    messageCollector.on('collect', async message => {
        if (message.author.id === client.user.id) return;
        if (message.channelId === conf.CHANNEL_ID) {
            console.log("message received");
            console.log(message.content);
            /** @type {string | [string]} */
            let passed_url = message.content;
            let is_multiple = false;
            if (message.content.includes("\n")) {
                //possible multiline
                is_multiple = true;
                passed_url = passed_url.split("\n");
            }
    
            if (!is_multiple) {
                passed_url = [].concat([passed_url]);
            }
    
            let target_pool = [];
            let process_pool = [];
            for (let target of passed_url) {
                if (ytdl.validateURL(target)) {
                    target_pool.push(target);
                    // await Promise.all([
                    //     addToQueue(passed_url),
                    //     message.delete()
                    // ]);
        
                } else if (verifyYTHost(target)) {
                        //Could just be a live video shared, ytdl doesn't like those for some reason
                        console.log('re-parsing possible live shared video link');
                        let parsedUrl = parseYTVideoUrl(target);
                        let reformatUrl = `https://youtube.com/watch?v=${parsedUrl.id}`;
                        if (ytdl.validateURL(reformatUrl)) {
                            console.log('re-parse succeeded.');
                            target_pool.push(reformatUrl);
                            // await Promise.all([
                            //     addToQueue(reformatUrl),
                            //     message.delete()
                            // ]);
                        }
                } else {
                    console.log("Rejecting invalid url");
                    channel.send({
                        content: "Invalid video URL. Either you sent a non-youtube link, or you sent a link to a playlist.\nCannot play full playlists at the moment.",
                        tts: false,
                        reply: {
                            messageReference: message.id
                        }
                    }).then((reply_msg) => {
                        setTimeout(() => {
                            reply_msg.delete();
                            message.delete();
                        }, 20000);
                    });
                    return;
                }
            }
    
            
            for (let target of target_pool) {
                await addToQueue(target);
            }
            await message.delete();
            
    
    
            
        }
    });
}





client.login(token);
