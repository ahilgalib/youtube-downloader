# YouTube Downloader

A minimal, clean YouTube video and audio downloader. **For educational purposes only.**

Built with Node.js + Express, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg (bundled through `ffmpeg-static`). yt-dlp downloads itself the first time you run the app and updates itself on every start after that.

## Features

- **Video:** any available resolution (144p to 8K), MP4 / MKV / WEBM, codec choice (H.264, VP9, AV1), max FPS
- **Audio:** MP3, M4A, OPUS, FLAC, WAV or the original stream, at 96 to 320 kbps or best VBR
- **Advanced options**
  - Trim: download only part of a video (`1:30` to `2:45`)
  - Embedded subtitles, including auto-generated ones, in any language
  - Embedded thumbnail, metadata and chapters
  - SponsorBlock: remove sponsors, intros, outros and self-promos
  - Custom filename template (`%(title)s - %(channel)s`, and so on)
  - Speed limit
  - Exact format ID picker with the full format table (for example `137+140`)
- Live progress with speed and ETA
- Automatic light and dark mode, works on phones

## Run it

You need [Node.js 18+](https://nodejs.org).

```bash
git clone https://github.com/ahilgalib/youtube-downloader.git
cd youtube-downloader
npm install
npm start
```

Then open **http://localhost:3000**.

On Windows you can also just double-click **`start.bat`**.

## Notes

- This needs a server, because browsers can't download from YouTube directly. It won't run on GitHub Pages. To host it, you can use any Node host that allows binaries (a VPS, Render, Railway, Fly.io).
- Downloaded files are kept in `downloads/` and cleared after 1 hour.
- If a download suddenly fails, YouTube probably changed something. Restart the app so yt-dlp updates itself.

## Disclaimer

This project is for learning purposes only. Respect copyright and the [YouTube Terms of Service](https://www.youtube.com/t/terms). Only download content you own or have permission to use.

---

### বাংলা

**শুধুমাত্র শিক্ষামূলক উদ্দেশ্যে।** Node.js ইনস্টল করে `npm install` তারপর `npm start` চালান (Windows-এ `start.bat` ডাবল-ক্লিক করলেই হবে), তারপর ব্রাউজারে http://localhost:3000 খুলুন। লিংক পেস্ট করুন, রেজুলেশন বা অডিও ফরম্যাট বেছে নিন, তারপর Download চাপুন।
