import path from 'path';
import fs from 'fs';

export const ROOT = path.resolve(__dirname, '../..');
export const MARKETING = path.resolve(__dirname, '..');

export const RAW = path.join(MARKETING, 'raw');
export const COMPOSITES = path.join(MARKETING, 'composites');
export const VIDEOS = path.join(MARKETING, 'videos');
export const VOICEOVER = path.join(MARKETING, 'voiceover');
export const ASSETS = path.join(MARKETING, 'assets');
export const FONTS = path.join(MARKETING, 'fonts');

export function ensure(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const DIRS = {
  chrome: () => ensure(path.join(RAW, 'chrome')),
  firefox: () => ensure(path.join(RAW, 'firefox')),
  safari: () => ensure(path.join(RAW, 'safari')),
  ios: () => ensure(path.join(RAW, 'ios')),
  android: () => ensure(path.join(RAW, 'android')),
  web: () => ensure(path.join(RAW, 'web')),
  popupFrames: () => ensure(path.join(RAW, 'popup-frames')),
  composites: () => ensure(COMPOSITES),
  videos: () => ensure(VIDEOS),
  voiceover: () => ensure(VOICEOVER),
};
