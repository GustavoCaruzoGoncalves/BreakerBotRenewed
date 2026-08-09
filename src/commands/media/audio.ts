import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import axios from 'axios';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import type { AnyMessageContent } from '@whiskeysockets/baileys';
import { projectPath } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { Command, CommandHandler, WAMessage, WASocket } from '../../types/bot.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const COOKIES_PATH = projectPath('cookies.txt');
const FFMPEG_DIR = (ffmpegPath ?? '').replace(/ffmpeg(\.exe)?$/, '');
const YT_BASE = ['--no-warnings', '--remote-components', 'ejs:github'];
const MEDIA_EXTS = new Set(['.mp4', '.webm', '.mkv', '.m4a', '.opus', '.mp3']);

const VIDEO_FMT = [
  'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]',
  'bestvideo[height<=1080][vcodec^=avc]+bestaudio',
  'best[height<=1080]',
].join('/');

// yt-dlp on some Linux deploys needs Deno in PATH
process.env.DENO_INSTALL = '/root/.deno';
process.env.PATH = `/root/.deno/bin:${process.env.PATH}`;

type MediaKind = 'audio' | 'video';

interface VideoInfo {
  title: string;
  thumbnail: string | null;
}

// --- Helpers ---

function tmp(prefix: string, ext: string): string {
  return path.join(os.tmpdir(), `bb_${prefix}_${crypto.randomBytes(6).toString('hex')}.${ext}`);
}

function cleanup(...files: string[]): void {
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* noop */
    }
  }
}

function ytdlp(args: string[]): SpawnSyncReturns<string> {
  const all = [...args, ...YT_BASE];
  if (fs.existsSync(COOKIES_PATH)) all.push('--cookies', COOKIES_PATH);
  return spawnSync('yt-dlp', all, { encoding: 'utf-8', env: process.env });
}

// --- yt-dlp operations ---

function getVideoInfo(query: string): VideoInfo {
  const r = ytdlp([query, '--print', '%(title)s', '--print', '%(thumbnail)s']);
  if (r.status !== 0 || !r.stdout) return { title: 'Vídeo', thumbnail: null };
  const [title, thumbnail] = r.stdout.trim().split('\n');
  return { title: title || 'Vídeo', thumbnail: thumbnail || null };
}

function chooseFallbackFormat(url: string, mediaType: MediaKind): string | null {
  const r = ytdlp([url, '--list-formats']);
  if (r.status !== 0 || !r.stdout) return null;

  const lines = r.stdout.split('\n').filter((l) => {
    const t = l.trim();
    return t && !/^(ID|─|-)/.test(t) && !/storyboard|images/.test(t) && /^\w/.test(t);
  });

  const audio: string[] = [];
  const video: Array<{ id: string; h: number }> = [];

  for (const line of lines) {
    const id = line.trim().split(/\s+/)[0];
    if (!id) continue;
    if (line.includes('audio only')) {
      audio.push(id);
    } else {
      const m = line.match(/(\d+)x(\d+)/);
      if (m?.[2]) video.push({ id, h: parseInt(m[2], 10) });
    }
  }

  if (mediaType === 'audio') return audio.at(-1) ?? null;

  const best = video.filter((f) => f.h <= 1080).at(-1) ?? video.at(-1);
  if (!best) return null;
  return audio.length ? `${best.id}+${audio.at(-1)}` : best.id;
}

type Attempt = true | SpawnSyncReturns<string>;

async function ytDownload(
  url: string,
  outputPath: string,
  format: string,
  mediaType: MediaKind = 'video',
): Promise<void> {
  const base = outputPath.replace(/\.[^/.]+$/, '');
  const dir = path.dirname(outputPath);

  const dlArgs = (fmt: string, extra: string[] = []): string[] => [
    url,
    '-o',
    `${base}.%(ext)s`,
    '-f',
    fmt,
    '--no-check-certificates',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    FFMPEG_DIR,
    '--force-overwrites',
    ...extra,
  ];

  function resolveFile(): void {
    const baseName = path.basename(base);
    const files = fs.readdirSync(dir);

    const match = files.find(
      (f) => f.startsWith(baseName) && !f.includes('.f') && MEDIA_EXTS.has(path.extname(f)),
    );
    if (match) {
      const full = path.join(dir, match);
      if (full !== outputPath) fs.renameSync(full, outputPath);
    }

    for (const f of files.filter((f) => f.startsWith(baseName) && f.includes('.f'))) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* noop */
      }
    }
  }

  function attempt(args: string[]): Attempt {
    const r = ytdlp(args);
    if (r.status === 0) {
      resolveFile();
      return true;
    }
    return r;
  }

  // 1) Requested format
  let r = attempt(dlArgs(format));
  if (r === true) return;

  const output = (r.stderr || '') + (r.stdout || '');
  if (!output.includes('Requested format is not available')) {
    throw new Error(`yt-dlp falhou (code ${r.status})`);
  }

  // 2) Pick from available formats
  const fallback = chooseFallbackFormat(url, mediaType);
  if (fallback) {
    r = attempt(dlArgs(fallback));
    if (r === true) return;
  }

  // 3) YouTube player client rotation
  const generic =
    mediaType === 'audio'
      ? 'bestaudio/best'
      : 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';

  for (const c of ['ios', 'android', 'ios,web', 'android,ios', 'mweb']) {
    r = attempt(dlArgs(generic, ['--extractor-args', `youtube:player_client=${c}`]));
    if (r === true) return;
  }

  // 4) Last resort — no format restriction
  for (const c of ['ios', 'android']) {
    r = attempt(dlArgs('best', ['--extractor-args', `youtube:player_client=${c}`]));
    if (r === true) return;
  }

  throw new Error('yt-dlp: nenhum formato disponível');
}

// --- Media processing ---

async function fetchThumbnail(url: string | null, dest: string): Promise<string | null> {
  if (!url) return null;
  try {
    const { data } = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    fs.writeFileSync(dest, Buffer.from(data));
    return dest;
  } catch {
    return null;
  }
}

function extractVideoFrame(videoPath: string, dest: string): Promise<string | null> {
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: path.basename(dest),
        folder: path.dirname(dest),
        size: '320x180',
      })
      .on('end', () => resolve(dest))
      .on('error', () => resolve(null));
  });
}

function convertToMp3(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('mp3')
      .audioBitrate('128k')
      .audioChannels(2)
      .audioFrequency(44100)
      .outputOptions(['-threads', '1'])
      .on('end', () => resolve())
      .on('error', reject)
      .save(output);
  });
}

// --- WhatsApp preview message ---

interface TextPreviewMessage {
  text: string;
  jpegThumbnail?: Buffer;
  matchedText?: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
}

/**
 * O Baileys declara `jpegThumbnail: string` no conteúdo de vídeo, mas o campo do
 * protobuf é `bytes` e a lib repassa o valor sem converter — daí o Buffer aqui.
 */
interface VideoMessage {
  video: Buffer;
  caption: string;
  mimetype: string;
  jpegThumbnail?: Buffer;
}

async function sendPreview(
  sock: WASocket,
  jid: string,
  raw: WAMessage,
  info: VideoInfo,
  query: string,
  thumbPath: string,
  emoji: string,
  desc: string,
): Promise<void> {
  const msg: TextPreviewMessage = { text: `${emoji} Buscando: *${info.title}*...` };
  if (fs.existsSync(thumbPath)) {
    msg.jpegThumbnail = fs.readFileSync(thumbPath);
    msg.matchedText = query;
    msg.canonicalUrl = query;
    msg.title = info.title;
    msg.description = desc;
  }
  await sock.sendMessage(jid, msg, { quoted: raw });
}

// --- Command handlers ---

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;

  if (text.startsWith('!play ')) return handlePlay(sock, raw, jid, text.slice(6).trim());
  if (text.startsWith('!playmp4 ')) return handlePlayMp4(sock, raw, jid, text.slice(9).trim());
};

const audioCommand: Command = {
  meta: {
    category: 'Figurinhas e mídia',
    entries: [
      {
        trigger: '!play',
        description: 'Baixa o áudio de um vídeo do YouTube',
        usages: [{ syntax: '!play <link ou busca>', description: 'Envia o MP3 com a capa' }],
      },
      {
        trigger: '!playmp4',
        description: 'Baixa o vídeo do YouTube em MP4',
        usages: [{ syntax: '!playmp4 <link ou busca>', description: 'Envia o vídeo' }],
      },
    ],
  },
  handle,
};

async function handlePlay(
  sock: WASocket,
  raw: WAMessage,
  jid: string,
  query: string,
): Promise<void> {
  if (!query) {
    await sock.sendMessage(
      jid,
      { text: 'Por favor, digite o nome ou link da música!' },
      { quoted: raw },
    );
    return;
  }

  const dlPath = tmp('play', 'webm');
  const mp3Path = tmp('play', 'mp3');
  const thumbPath = tmp('thumb', 'jpg');

  try {
    const info = getVideoInfo(query);
    await fetchThumbnail(info.thumbnail, thumbPath);
    await sendPreview(sock, jid, raw, info, query, thumbPath, '🎵', 'Baixando música do YouTube...');

    await ytDownload(query, dlPath, 'bestaudio/best', 'audio');
    await convertToMp3(dlPath, mp3Path);

    await sock.sendMessage(
      jid,
      {
        audio: fs.readFileSync(mp3Path),
        mimetype: 'audio/mp4',
        fileName: `${query}.mp3`,
      },
      { quoted: raw },
    );
  } catch (err) {
    console.error('[play]', getErrorMessage(err));
    await sock.sendMessage(jid, { text: 'Erro ao baixar a música!' }, { quoted: raw });
  } finally {
    cleanup(dlPath, mp3Path, thumbPath);
  }
}

async function handlePlayMp4(
  sock: WASocket,
  raw: WAMessage,
  jid: string,
  query: string,
): Promise<void> {
  if (!query) {
    await sock.sendMessage(
      jid,
      { text: 'Por favor, digite o nome ou link do vídeo!' },
      { quoted: raw },
    );
    return;
  }

  const videoPath = tmp('video', 'mp4');
  const thumbPath = tmp('thumb', 'jpg');
  const framePath = tmp('frame', 'jpg');

  try {
    const info = getVideoInfo(query);
    await fetchThumbnail(info.thumbnail, thumbPath);
    await sendPreview(sock, jid, raw, info, query, thumbPath, '🎥', 'Baixando vídeo do YouTube...');

    await ytDownload(query, videoPath, VIDEO_FMT, 'video');
    if (!fs.existsSync(videoPath)) throw new Error('Arquivo não foi baixado');

    await extractVideoFrame(videoPath, framePath);

    const message: VideoMessage = {
      video: fs.readFileSync(videoPath),
      caption: `✨ *${info.title}*`,
      mimetype: 'video/mp4',
    };
    if (fs.existsSync(framePath)) {
      message.jpegThumbnail = fs.readFileSync(framePath);
    }

    await sock.sendMessage(jid, message as unknown as AnyMessageContent, { quoted: raw });
  } catch (err) {
    console.error('[playmp4]', getErrorMessage(err));
    await sock.sendMessage(jid, { text: 'Erro ao baixar o vídeo!' }, { quoted: raw });
  } finally {
    cleanup(videoPath, thumbPath, framePath);
  }
}

export default audioCommand;
