# Install/setup

Run `./choco-setup.ps1` while in the repo folder. You may need to enable running PS Scripts from unsigned sources, else Windows will be mad at you.

Accept all default options when prompted, yt-dlp is preinstalled via chocolatey.

It will install all the needed dependencies, fetch mpv, ffmpeg, and set them up in the `mpv` folder.

Chocolatey will also install/setup python3, ffmpeg, yt-dlp, nvm, and 7zip.

nvm is then used to get the latest nodejs version, and set that as active.

# Configuration

Just set the `CHANNEL_ID` field in `config.template.json` to the channel name you want the bot to watch, saving the file as `config.json`.

Set the `token` field in `bot-token.template.json` to your Discord bot token, and save the file as `bot-token.json`.

Then run the bot via `node index.js`

