'use strict';
// Görünüm ayarları yalnızca bu cihazda saklanır: tema, renk, sohbet arka planı, yazı boyutu.
// Sayfa çizilmeden önce çalışır ki tema yanıp sönmesin.
const LOOK_KEY = 'educom-look';
const WALL_KEY = 'educom-wall';
const look = { theme: 'auto', accent: 'purple', wall: 'school', size: 'md' };
try {
  Object.assign(look, JSON.parse(localStorage.getItem(LOOK_KEY)) || {});
} catch {}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyRootLook() {
  const root = document.documentElement;
  const dark = look.theme === 'dark' || (look.theme === 'auto' && darkQuery.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = look.accent;
  root.dataset.size = look.size;
  // Telefonun durum çubuğu üst şeritle aynı renkte olsun. Renk oklch ile tanımlı; tuval onu RGB'ye çevirir.
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = '#70449c';
  ctx.fillStyle = getComputedStyle(root).getPropertyValue('--brand').trim();
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  document.querySelector('meta[name=theme-color]').content = `rgb(${r}, ${g}, ${b})`;
}

function saveLook() {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {}
}

applyRootLook();
darkQuery.addEventListener('change', applyRootLook);
