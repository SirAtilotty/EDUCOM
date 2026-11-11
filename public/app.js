'use strict';
// Sunucudan gelen metin her zaman textContent ile yazılır, HTML olarak yorumlanmaz.
const $ = (id) => document.getElementById(id);
const PAGE = 50;
const MAX_SIDE = 1600;
const MAX_FILE = 10 * 1024 * 1024; // sunucudaki sınırla aynı
const RUN_GAP = 5 * 60 * 1000; // aynı kişinin bu süre içindeki mesajları tek grup görünür
const LETTERS = 'ABCDE';
const QUIZ_SIZE = 20; // bir oturumda en fazla bu kadar soru sorulur
// Ders adı önerileri; öğretmen listede olmayan bir dersi de yazabilir.
const SUBJECTS = [
  'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Türk Dili ve Edebiyatı', 'Tarih',
  'T.C. İnkılap Tarihi ve Atatürkçülük', 'Coğrafya', 'İngilizce', 'Almanca', 'Felsefe',
  'Din Kültürü ve Ahlak Bilgisi', 'Beden Eğitimi', 'Görsel Sanatlar', 'Müzik', 'Bilişim Teknolojileri',
];

let me = null;
let convos = [];
let current = null;
let events = null;
let replyTo = null;
let tab = 'chats';
const typing = new Map(); // "sohbet:kişi" -> { convoId, name, kind, timer }

async function api(url, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.json !== undefined) {
    init.body = JSON.stringify(options.json);
    init.headers['Content-Type'] = 'application/json';
  } else if (options.body) {
    init.body = options.body;
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(t('networkError'));
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && me) showAuth();
  if (!res.ok) throw new Error(t(`err.${data.error || 'serverError'}`));
  return data;
}

function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// Herkesin kendi rengi olur; renk kimliğe bağlı, isim değişse de aynı kalır.
const hue = (id) => `hue${id % 8}`;
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0]).join('').toLocaleUpperCase(locale());
}
function avatar(name, id, group = false) {
  return h('span', { className: `avatar ${group ? 'hue-group' : hue(id)}`, textContent: initials(name), ariaHidden: 'true' });
}

const formError = (form, text) => { form.querySelector('.error').textContent = text; };
const isVoice = (file) => /\.(webm|ogg)$/.test(file);
const isDoc = (file) => /\.(pdf|docx?|xlsx?|pptx?)$/.test(file);
// Belgede mesaj metni dosyanın adıdır.
const snippet = (body, image) => (!image || isDoc(image) ? body : t(isVoice(image) ? 'voice' : 'photo'));
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const clock = (at) => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const isTeacher = () => me?.role === 'teacher';
// Öğrenciler sınıf grubunu yalnızca okur.
// Öğrenci sınıf grubuna ve başka öğrencinin olduğu sohbete yazamaz (sunucu da reddeder).
const readOnly = (convo) => Boolean(convo) && !isTeacher()
  && (Boolean(convo.classId) || convo.members.some((m) => m.role === 'student' && m.id !== me.id));
const deleteButton = (onclick) => h('button', { type: 'button', className: 'icon-button', title: t('delete'), ariaLabel: t('delete'), onclick }, icon('trash'));

function dayLabel(at) {
  if (sameDay(at, Date.now())) return t('today');
  if (sameDay(at, Date.now() - 864e5)) return t('yesterday');
  const date = new Date(at);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year });
}

// Teslim tarihleri "2025-11-14" biçimindedir ve telefonun kendi saatine göre okunur.
const localDate = (iso) => new Date(`${iso}T00:00`);
const dateLabel = (iso) => localDate(iso).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function daysUntil(iso) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((localDate(iso) - today) / 864e5);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---- Giriş
function showAuth() {
  me = null;
  current = null;
  if (events) events.close();
  events = null;
  document.body.classList.remove('teacher', 'admin');
  admin = null;
  // Aynı telefonda başka hesap açılırsa önceki kişinin yarım kalan soru oturumu kalmasın.
  quiz = null;
  run = null;
  openSubject = null;
  showQuizPanel('home');
  $('app').hidden = true;
  $('auth').hidden = false;
  const invite = /^#invite=(.+)$/.exec(location.hash);
  if (invite) $('register-form').elements.invite.value = invite[1];
  $('login-form').hidden = Boolean(invite);
  $('register-form').hidden = !invite;
}

async function showApp(user) {
  me = user;
  if (location.hash) history.replaceState(null, '', location.pathname);
  document.body.classList.toggle('teacher', isTeacher());
  document.body.classList.toggle('admin', me.admin);
  $('auth').hidden = true;
  $('app').hidden = false;
  $('login-form').reset();
  $('register-form').reset();
  renderMe();
  closeChat();
  showTab('chats');
  await loadConvos();
  connect();
  setupPush();
}

function renderMe() {
  $('open-profile').replaceChildren(avatar(me.name, me.id));
}

function authSubmit(form, url) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, '');
    try {
      await showApp(await api(url, { method: 'POST', json: Object.fromEntries(new FormData(form)) }));
    } catch (err) {
      formError(form, err.message);
    }
  });
}
authSubmit($('login-form'), '/api/login');
authSubmit($('register-form'), '/api/register');

function toggleAuth(showRegister) {
  $('login-form').hidden = showRegister;
  $('register-form').hidden = !showRegister;
}
$('show-register').onclick = () => toggleAuth(true);
$('show-login').onclick = () => toggleAuth(false);
// Giriş ekranı açıkken kayıt linki aynı sekmede açılırsa sayfa yenilenmez.
addEventListener('hashchange', () => { if (!me) showAuth(); });

// ---- Sekmeler: sohbetler, ödevler, yazılı hazırlık, gelişim notları
function showTab(name) {
  tab = name;
  for (const button of document.querySelectorAll('.tabs button')) {
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const view of ['chats', 'homework', 'quiz', 'notes', 'admin']) $(`view-${view}`).hidden = view !== name;
  // Diğer sekmeler geniş ekranda tüm genişliği kullanır; açık sohbet arkada okunmuş sayılmasın diye kapanır.
  $('app').classList.toggle('wide', name !== 'chats');
  $('open-new').hidden = name !== 'chats';
  if (name !== 'chats' && current) closeChat();
  if (name === 'homework') loadHomework();
  if (name === 'quiz' && !run) loadQuiz();
  if (name === 'notes') loadNotes();
  if (name === 'admin') loadAdmin();
}
// Yönetim paneli alt sekmelerde değil üst çubuktadır; yalnızca yönetici görür.
$('open-admin').onclick = () => showTab('admin');
for (const button of document.querySelectorAll('.tabs button')) button.onclick = () => showTab(button.dataset.tab);

// ---- Canlı akış
function connect() {
  events = new EventSource('/api/events');
  // Her bağlantıda çekilir: kopukken gelenler kaçmasın.
  events.onopen = () => resync().catch(() => {});
  events.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'typing') return onTyping(event);
    if (event.type === 'read') return onRead(event);
    if (event.type === 'homework') return tab === 'homework' && loadHomework();
    if (event.type === 'note') return tab === 'notes' && loadNotes();
    if (event.type === 'deleted' && event.convoId === current) removeMessage(event.id);
    if (event.type === 'message') {
      const m = event.message;
      stopTyping(m.convoId, m.userId);
      // Bildirim izni varsa arka planda sesi telefonun bildirimi çalar; iki kez çalmasın.
      if (m.userId !== me.id && (!document.hidden || !pushSupported || Notification.permission !== 'granted')) playSound();
      if (m.convoId === current) {
        addMessage(m);
        markRead();
      }
    }
    loadConvos().then(() => {
      // Grup adı, üyeler değişmiş ya da bu cihazdan başka yerde gruptan çıkılmış olabilir.
      if (event.type === 'convo' && current) {
        if (convos.some((c) => c.id === current)) renderHeader();
        else closeChat();
      }
    }, () => {});
  };
  events.onerror = () => {
    // Tarayıcı kopmalarda kendisi yeniden dener, ama 401/502 gibi yanıtlarda vazgeçer.
    if (events.readyState === EventSource.CLOSED) setTimeout(reconnect, 5000);
  };
}

function reconnect() {
  if (!me) return;
  // Oturum bittiyse api() giriş ekranını açar ve me boşalır; sunucu yoksa denemeye devam edilir.
  api('/api/me').then(connect, () => setTimeout(reconnect, 5000));
}

async function resync() {
  await loadConvos();
  if (current) await openConvo(current, false);
  if (tab === 'homework') loadHomework();
  if (tab === 'notes') loadNotes();
}

// ---- Yazıyor / ses kaydediyor
function onTyping(event) {
  if (event.userId === me.id) return;
  const key = `${event.convoId}:${event.userId}`;
  clearTimeout(typing.get(key)?.timer);
  // Karşı taraf 3 saniyede bir haber verir; haber kesilirse gösterge kendiliğinden kalkar.
  const timer = setTimeout(() => stopTyping(event.convoId, event.userId), 5000);
  typing.set(key, { convoId: event.convoId, name: event.name, kind: event.kind, timer });
  renderTyping();
}

function stopTyping(convoId, userId) {
  const key = `${convoId}:${userId}`;
  if (!typing.has(key)) return;
  clearTimeout(typing.get(key).timer);
  typing.delete(key);
  renderTyping();
}

function typingEl(convo) {
  const who = [...typing.values()].find((x) => x.convoId === convo.id);
  if (!who) return null;
  const key = who.kind === 'voice' ? 'recording' : 'typing';
  const text = convo.title ? t(`${key}Name`, { name: who.name }) : t(key);
  return h('span', { className: 'typing' }, who.kind === 'voice' ? icon('mic') : '', text);
}

function renderTyping() {
  renderConvos();
  if (current) renderHeader();
}

let lastTyping = 0;
function sendTyping(kind, id = current) {
  if (!id || Date.now() - lastTyping < 3000) return;
  lastTyping = Date.now();
  api(`/api/convos/${id}/typing`, { method: 'POST', json: { kind } }).catch(() => {});
}

// ---- Okundu bilgisi
function onRead(event) {
  const convo = convos.find((c) => c.id === event.convoId);
  const member = convo?.members.find((m) => m.id === event.userId);
  if (member) member.lastRead = Math.max(member.lastRead, event.lastRead);
  if (event.userId === me.id) loadConvos().catch(() => {}); // başka cihazda okundu: rozet silinsin
  else if (event.convoId === current) updateTicks();
}

// Grupta çift tik, herkes okuyunca çıkar.
function readUpTo(convo) {
  const others = convo.members.filter((m) => m.id !== me.id);
  return others.length ? Math.min(...others.map((m) => m.lastRead)) : 0;
}

function updateTicks() {
  const convo = convos.find((c) => c.id === current);
  if (!convo) return;
  const upTo = readUpTo(convo);
  for (const el of $('messages').querySelectorAll('.message.mine .ticks')) {
    const read = Number(el.closest('.message').dataset.id) <= upTo;
    if (el.classList.contains('read') === read && el.firstChild) continue;
    el.classList.toggle('read', read);
    el.title = t(read ? 'read' : 'sent');
    el.replaceChildren(icon(read ? 'checks' : 'check'), h('span', { className: 'sr', textContent: el.title }));
  }
}

// ---- Mesaj sesi
// Tarayıcılar ilk dokunuştan önce ses çalmaya izin vermez; ses dosyası gerekmez, tonlar burada üretilir.
let audio = null;
function unlockAudio() {
  audio ??= new AudioContext();
  audio.resume();
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

function playSound() {
  if (!audio) return;
  audio.resume();
  [[880, 0], [1175, 0.13]].forEach(([frequency, delay]) => {
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.22);
  });
}

// ---- Telefon bildirimi
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function subscribePush() {
  await navigator.serviceWorker.register(`/sw.js?lang=${lang}`);
  const registration = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push-key');
  const applicationServerKey = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await api('/api/push', { method: 'POST', json: { endpoint: subscription.endpoint } });
}

function setupPush() {
  if (!pushSupported) return; // HTTPS olmadan da burada kalır; uygulama bildirimsiz çalışmaya devam eder
  $('push-banner').hidden = Notification.permission !== 'default';
  // Her açılışta yenilenir: abonelik adresi değişmiş veya hesap değişmiş olabilir.
  if (Notification.permission === 'granted') subscribePush().catch((err) => console.error(err));
}

$('enable-push').onclick = async () => {
  $('push-error').textContent = '';
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') await subscribePush();
    $('push-banner').hidden = true;
  } catch {
    $('push-error').textContent = t('pushFailed');
  }
};

async function pushSubscription() {
  if (!pushSupported) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) || null;
}

// Çıkış yapılan telefona artık bildirim gitmesin. Hata çıkışı engellemez.
async function disablePush() {
  const subscription = await pushSubscription();
  if (!subscription) return;
  await api('/api/push', { method: 'DELETE', json: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}

// ---- Sohbet listesi
const others = (c) => c.members.filter((m) => m.id !== me.id);
const convoName = (c) => c.title || others(c).map((m) => m.name).join(', ') || t('chat');
function convoAvatar(c) {
  if (c.classId) return h('span', { className: 'avatar hue-group class-avatar', textContent: c.title, ariaHidden: 'true' });
  const other = others(c)[0];
  return c.title || !other ? avatar(convoName(c), c.id, true) : avatar(other.name, other.id);
}

async function loadConvos() {
  convos = await api('/api/convos');
  renderConvos();
}

function listTime(at) {
  if (sameDay(at, Date.now())) return clock(at);
  if (sameDay(at, Date.now() - 864e5)) return t('yesterday');
  return new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

function renderConvos() {
  const unread = convos.reduce((sum, c) => sum + c.unread, 0);
  document.title = unread ? `(${unread}) EDUCOM` : 'EDUCOM';
  $('chats-badge').hidden = !unread;
  $('chats-badge').textContent = unread;
  $('no-convos').hidden = convos.length > 0;
  $('convos').replaceChildren(...convos.map((c) => {
    let preview = typingEl(c);
    if (!preview) {
      const kind = c.lastImage && (isVoice(c.lastImage) ? 'mic' : isDoc(c.lastImage) ? 'file' : 'camera');
      preview = h('span', {}, kind ? icon(kind) : '', c.lastId ? snippet(c.lastBody, c.lastImage) : t('noMessagesYet'));
    }
    preview.classList.add('preview');
    const button = h('button', { className: 'convo', onclick: () => openConvo(c.id) },
      convoAvatar(c),
      h('span', { className: 'convo-text' },
        h('span', { className: 'convo-top' },
          h('strong', { textContent: convoName(c) }),
          c.lastAt ? h('time', { textContent: listTime(c.lastAt) }) : ''),
        h('span', { className: 'convo-bottom' },
          preview,
          c.unread ? h('span', { className: 'badge', textContent: c.unread, title: t('unread', { count: c.unread }) }) : '')));
    if (c.unread) button.classList.add('has-unread');
    if (c.id === current) button.setAttribute('aria-current', 'true');
    return h('li', {}, button);
  }));
}

// ---- Açık sohbet
function closeChat() {
  current = null;
  setReply(null);
  $('app').classList.remove('in-chat');
  $('chat-open').hidden = true;
  $('no-chat').hidden = false;
  renderConvos();
}

function headerSub(convo) {
  if (convo.classId) {
    const teachers = convo.members.filter((m) => m.role === 'teacher').length;
    return t('classMembers', { students: convo.members.length - teachers, teachers });
  }
  return convo.title ? convo.members.map((m) => (m.id === me.id ? t('you') : m.name)).join(', ') : '';
}

function renderHeader() {
  const convo = convos.find((c) => c.id === current);
  if (!convo) return;
  $('chat-avatar').replaceChildren(convoAvatar(convo));
  $('chat-name').textContent = convoName(convo);
  $('chat-sub').replaceChildren(typingEl(convo) || headerSub(convo));
  $('open-group').hidden = !convo.title;
  const ro = readOnly(convo);
  $('send-form').hidden = ro;
  $('read-only').hidden = !ro;
  $('read-only').textContent = convo.classId ? t('readOnlyClass') : t('readOnlyStudents');
  if (ro && replyTo) setReply(null);
}

async function openConvo(id, navigate = true) {
  const convo = convos.find((c) => c.id === id);
  if (!convo) return closeChat();
  // Telefonda geri tuşu uygulamadan çıkmak yerine listeye dönsün.
  if (navigate && current === null) history.pushState({ chat: true }, '');
  if (current !== id) setReply(null);
  current = id;
  $('app').classList.add('in-chat');
  $('no-chat').hidden = true;
  $('chat-open').hidden = false;
  renderHeader();
  $('send-error').textContent = '';
  renderConvos();
  const box = $('messages');
  box.replaceChildren();
  try {
    const list = await api(`/api/convos/${id}/messages`);
    if (current !== id) return;
    box.replaceChildren();
    prependOlder(list);
    box.scrollTop = box.scrollHeight;
    markRead();
  } catch (err) {
    $('send-error').textContent = err.message;
  }
}

function prependOlder(list) {
  const box = $('messages');
  box.querySelector('.older')?.remove();
  box.prepend(...list.map(messageEl));
  if (list.length === PAGE) {
    const older = h('button', { type: 'button', className: 'older', textContent: t('olderMessages') });
    older.onclick = async () => {
      const id = current;
      const oldHeight = box.scrollHeight;
      const before = box.querySelector('.message').dataset.id;
      try {
        const page = await api(`/api/convos/${id}/messages?before=${before}`);
        if (current !== id) return;
        prependOlder(page);
        box.scrollTop = box.scrollHeight - oldHeight;
      } catch (err) {
        $('send-error').textContent = err.message;
      }
    };
    box.prepend(older);
  }
  decorate();
}

// Gün ayıraçlarını koyar ve art arda gelen mesajları gruplar; her eklemeden sonra baştan hesaplanır.
function decorate() {
  const box = $('messages');
  for (const day of box.querySelectorAll('.day')) day.remove();
  const list = [...box.querySelectorAll('.message')];
  const joins = (a, b) => a && b && a.dataset.user === b.dataset.user && b.dataset.at - a.dataset.at < RUN_GAP && sameDay(+a.dataset.at, +b.dataset.at);
  list.forEach((el, i) => {
    const prev = list[i - 1];
    if (!prev || !sameDay(+prev.dataset.at, +el.dataset.at)) {
      el.before(h('div', { className: 'day' }, h('span', { textContent: dayLabel(+el.dataset.at) })));
    }
    el.classList.toggle('first', !joins(prev, el));
    el.classList.toggle('last', !joins(el, list[i + 1]));
  });
  updateTicks();
}

function quoteEl(m) {
  const quote = h('button', { type: 'button', className: 'quote' },
    h('strong', { textContent: m.replyName }),
    h('span', { textContent: snippet(m.replyBody, m.replyImage) }));
  quote.onclick = () => {
    const target = $(`m${m.replyId}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth; // animasyon tekrar başlasın
    target.classList.add('flash');
  };
  return quote;
}

function messageEl(m) {
  const mine = m.userId === me.id;
  const convo = convos.find((c) => c.id === m.convoId);
  const el = h('div', { className: `message${mine ? ' mine' : ''}`, id: `m${m.id}` });
  Object.assign(el.dataset, { id: m.id, user: m.userId, at: m.at });
  const bubble = h('div', { className: 'bubble' });
  if (!mine && convo?.title) {
    bubble.append(h('span', { className: `sender ${hue(m.userId)}` }, m.name,
      m.role === 'teacher' ? h('span', { className: 'role-badge', textContent: t('teacher') }) : ''));
  }
  if (m.replyId) bubble.append(quoteEl(m));
  if (m.image && isVoice(m.image)) {
    bubble.append(h('audio', { src: `/uploads/${m.image}`, controls: true, preload: 'metadata', ariaLabel: t('voiceFrom', { name: m.name }) }));
  } else if (m.image && isDoc(m.image)) {
    bubble.append(h('a', { className: 'file', href: `/uploads/${m.image}`, download: m.body },
      icon('file'),
      h('span', {}, h('strong', { textContent: m.body }), h('small', { textContent: m.image.split('.').pop().toUpperCase() }))));
  } else if (m.image) {
    const src = `/uploads/${m.image}`;
    const alt = t('photoAlt', { name: m.name });
    bubble.append(h('button', { type: 'button', className: 'photo', onclick: () => showPhoto(src, alt) },
      h('img', { src, alt, loading: 'lazy' })));
  }
  if (m.body && !(m.image && isDoc(m.image))) bubble.append(h('p', { textContent: m.body }));
  bubble.append(h('span', { className: 'meta' },
    h('time', { textContent: clock(m.at), title: new Date(m.at).toLocaleString(locale()) }),
    mine ? h('span', { className: 'ticks' }) : ''));
  el.append(bubble);
  // Sınıf grubunda öğrenci yazamadığı için yanıt da veremez.
  if (!readOnly(convo)) {
    el.append(h('button', { type: 'button', className: 'icon-button reply', title: t('reply'), ariaLabel: t('reply'), onclick: () => setReply(m) }, icon('reply')));
    swipeToReply(el, m);
  }
  // Kendi mesajını herkes, öğrencinin mesajını öğretmen siler (sunucu da aynı kuralı uygular).
  if (mine || (isTeacher() && m.role === 'student')) {
    el.append(h('button', { type: 'button', className: 'icon-button msg-delete', title: t('delete'), ariaLabel: t('delete'), onclick: () => deleteMessage(m) }, icon('trash')));
    // Telefonda üzerine gelme yok: balona dokununca sil düğmesi görünür.
    bubble.addEventListener('click', (e) => {
      if (!e.target.closest('button, audio') && matchMedia('(pointer: coarse)').matches) el.classList.toggle('show-actions');
    });
  }
  return el;
}

async function deleteMessage(m) {
  if (!confirm(t('deleteMessageConfirm'))) return;
  try {
    await api(`/api/convos/${m.convoId}/messages/${m.id}`, { method: 'DELETE' });
    removeMessage(m.id);
    loadConvos();
  } catch (err) {
    $('send-error').textContent = err.message;
  }
}

function removeMessage(id) {
  $(`m${id}`)?.remove();
  if (replyTo?.id === id) setReply(null);
  decorate();
}

// Telefonda mesajı sağa kaydırınca yanıtlanır; dikey kaydırma (sayfayı gezme) bozulmaz.
function swipeToReply(el, m) {
  let start = null;
  const reset = () => {
    start = null;
    el.style.transform = '';
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !e.target.closest('audio')) start = { x: e.clientX, y: e.clientY, dx: 0 };
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(e.clientY - start.y) > Math.abs(dx) + 10) return reset();
    start.dx = dx;
    el.style.transform = `translateX(${Math.max(0, Math.min(dx, 80))}px)`;
  });
  el.addEventListener('pointerup', () => {
    if (start?.dx > 60) setReply(m);
    reset();
  });
  el.addEventListener('pointercancel', reset);
}

function addMessage(m) {
  if ($(`m${m.id}`)) return; // hem POST yanıtından hem canlı akıştan gelebilir
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  box.append(messageEl(m));
  decorate();
  if (nearBottom || m.userId === me.id) box.scrollTop = box.scrollHeight;
}

async function markRead() {
  if (!current || document.hidden) return;
  const id = current;
  const convo = convos.find((c) => c.id === id);
  if (convo) convo.unread = 0;
  renderConvos();
  await api(`/api/convos/${id}/read`, { method: 'POST' }).catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (!me) return;
  if (!document.hidden) markRead();
});

// ---- Yanıt
function setReply(m) {
  replyTo = m;
  $('reply-bar').hidden = !m;
  if (!m) return;
  $('reply-name').textContent = t('replyingTo', { name: m.userId === me.id ? t('you') : m.name });
  $('reply-snippet').textContent = snippet(m.body, m.image);
  $('text').focus();
}
$('reply-cancel').onclick = () => setReply(null);
const replyParam = (id) => (replyTo && current === id ? replyTo.id : undefined);

// ---- Mesaj gönderme
// Yazı yoksa mikrofon, yazı varsa gönder düğmesi görünür.
const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices);
function updateSendButtons() {
  const empty = !$('text').value.trim();
  $('record').hidden = !canRecord || !empty || Boolean(recorder);
  $('send').hidden = canRecord && empty && !recorder;
}

$('text').addEventListener('input', () => {
  updateSendButtons();
  if ($('text').value.trim()) sendTyping('text');
});

$('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (recorder) return stopRecording(true);
  const body = $('text').value.trim();
  if (!body || !current) return;
  const id = current;
  $('send-error').textContent = '';
  try {
    const message = await api(`/api/convos/${id}/messages`, { method: 'POST', json: { body, replyTo: replyParam(id) } });
    // Metin ancak sunucu kaydettikten sonra silinir; hata olursa kullanıcının yazdığı kaybolmaz.
    $('text').value = '';
    lastTyping = 0;
    updateSendButtons();
    if (current === id) {
      setReply(null);
      addMessage(message);
    }
    loadConvos();
  } catch (err) {
    $('send-error').textContent = err.message;
  }
  $('text').focus();
});

$('text').addEventListener('keydown', (e) => {
  const desktop = matchMedia('(pointer: fine)').matches;
  if (e.key === 'Enter' && !e.shiftKey && desktop && !e.isComposing) {
    e.preventDefault();
    $('send-form').requestSubmit();
  }
});

// Yeniden kodlama boyutu küçültür ve fotoğraftaki konum bilgisini (EXIF) siler.
async function shrink(file, maxSide = MAX_SIDE, quality = 0.85) {
  if (file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = h('canvas', {
      width: Math.round(bitmap.width * scale),
      height: Math.round(bitmap.height * scale),
    });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
  } catch {
    return file; // tarayıcı çözemediyse dosyayı olduğu gibi gönder, sunucu türü denetler
  }
}

async function upload(id, body, status, name) {
  $('send-error').textContent = t(status);
  const reply = replyParam(id);
  const params = new URLSearchParams({ ...(reply && { replyTo: reply }), ...(name && { name }) });
  try {
    const message = await api(`/api/convos/${id}/images?${params}`, { method: 'POST', body });
    $('send-error').textContent = '';
    if (current === id) {
      if (replyTo?.id === reply) setReply(null);
      addMessage(message);
    }
    loadConvos();
  } catch (err) {
    $('send-error').textContent = err.message;
  }
}

$('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !current) return;
  if (file.type.startsWith('image/')) return upload(current, await shrink(file), 'sendingPhoto');
  // Belge olduğu gibi gider; türünü sunucu içeriğinden denetler.
  if (file.size > MAX_FILE) $('send-error').textContent = t('fileTooLarge');
  else upload(current, file, 'sendingFile', file.name);
});

// ---- Sesli mesaj: mikrofona dokununca kayıt başlar; gönder ile biter, çöp kutusu ile silinir.
let recorder = null;
let recording = null; // { id, stream, chunks, started, tick, send }

function setRecording(on) {
  $('send-form').classList.toggle('is-recording', on);
  $('text').hidden = on;
  $('attach').hidden = on;
  $('rec-strip').hidden = !on;
  updateSendButtons();
}

function stopRecording(send) {
  if (!recorder || recorder.state === 'inactive') return;
  recording.send = send;
  recorder.stop();
}

$('record').onclick = async () => {
  if (recorder || !current) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    $('send-error').textContent = t('micDenied');
    return;
  }
  const chunks = [];
  recording = { id: current, stream, chunks, started: Date.now(), send: false };
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => chunks.push(e.data);
  lastTyping = 0;
  const tick = () => {
    const s = Math.floor((Date.now() - recording.started) / 1000);
    $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    sendTyping('voice', recording.id);
    if (s >= 300) stopRecording(true); // 5 dakika, yükleme sınırının çok altında
  };
  recording.tick = setInterval(tick, 500);
  recorder.onstop = () => {
    const { id, send, started } = recording;
    clearInterval(recording.tick);
    for (const track of stream.getTracks()) track.stop();
    recorder = null;
    recording = null;
    setRecording(false);
    if (send && Date.now() - started > 1000) upload(id, new Blob(chunks, { type: chunks[0]?.type }), 'sendingVoice');
  };
  recorder.start();
  tick();
  setRecording(true);
};
$('rec-cancel').onclick = () => stopRecording(false);

// ---- Geri tuşu ve fotoğraf
$('back').onclick = () => history.back();
addEventListener('popstate', () => {
  if ($('photo-dialog').open) return $('photo-dialog').close();
  if (me && current) closeChat();
});

// Fotoğraf uygulama içinde büyür; yeni sekme açılınca telefonda oturum çerezi gitmiyordu.
function showPhoto(src, alt) {
  Object.assign($('photo-big'), { src, alt });
  history.pushState({ photo: true }, '');
  $('photo-dialog').showModal();
}
$('photo-dialog').onclick = () => history.back();
$('photo-dialog').oncancel = (e) => { e.preventDefault(); history.back(); };

// ---- Pencereler
for (const button of document.querySelectorAll('dialog .cancel')) {
  button.onclick = () => button.closest('dialog').close();
}

const personInfo = (u) => [u.username && `@${u.username}`, u.role === 'teacher' ? t('teacher') : u.classes].filter(Boolean).join(' · ');
const personRow = (u, checkbox) =>
  h('li', {}, h('label', {},
    checkbox ? h('input', { type: 'checkbox', name: 'user', value: u.id }) : '',
    avatar(u.name, u.id),
    h('span', { className: 'person-text' }, h('span', { textContent: u.name }), h('small', { textContent: personInfo(u) }))));

$('open-new').onclick = async () => {
  const form = $('new-form');
  form.reset();
  formError(form, '');
  $('title-field').hidden = true;
  const users = await api('/api/users').catch((err) => {
    formError(form, err.message);
    return [];
  });
  $('no-people').hidden = users.length > 0;
  $('people').replaceChildren(...users.map((u) => personRow(u, true)));
  $('new-dialog').showModal();
};

$('people').addEventListener('change', () => {
  $('title-field').hidden = $('new-form').querySelectorAll('[name=user]:checked').length < 2;
});

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const userIds = [...form.querySelectorAll('[name=user]:checked')].map((c) => Number(c.value));
  try {
    const { id } = await api('/api/convos', { method: 'POST', json: { userIds, title: form.elements.title.value } });
    $('new-dialog').close();
    await loadConvos();
    await openConvo(id);
  } catch (err) {
    formError(form, err.message);
  }
});

// ---- Grup bilgisi. Sınıf grubunda yalnızca üyeler görünür; adı ve üyeliği okul belirler.
$('open-group').onclick = async () => {
  const convo = convos.find((c) => c.id === current);
  if (!convo?.title) return;
  const isClass = Boolean(convo.classId);
  const form = $('group-form');
  form.reset();
  formError(form, '');
  form.elements.title.value = convo.title;
  form.elements.title.required = !isClass;
  for (const id of ['group-title-field', 'group-add-section', 'leave-group', 'group-save']) $(id).hidden = isClass;
  $('class-group-hint').hidden = !isClass;
  // Öğretmenler üstte, sonra ada göre.
  const members = [...convo.members].sort((a, z) => (z.role === 'teacher') - (a.role === 'teacher') || a.name.localeCompare(z.name, locale()));
  $('group-members').replaceChildren(...members.map((m) => personRow(m.id === me.id ? { ...m, name: t('you') } : m, false)));
  if (!isClass) {
    const users = await api('/api/users').catch((err) => {
      formError(form, err.message);
      return [];
    });
    const outside = users.filter((u) => !convo.members.some((m) => m.id === u.id));
    $('no-add').hidden = outside.length > 0;
    $('group-add').replaceChildren(...outside.map((u) => personRow(u, true)));
  }
  $('group-dialog').showModal();
};

$('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = current;
  const convo = convos.find((c) => c.id === id);
  const title = form.elements.title.value.trim();
  const userIds = [...form.querySelectorAll('[name=user]:checked')].map((c) => Number(c.value));
  try {
    if (title !== convo.title) await api(`/api/convos/${id}`, { method: 'PATCH', json: { title } });
    if (userIds.length) await api(`/api/convos/${id}/members`, { method: 'POST', json: { userIds } });
    $('group-dialog').close();
    await loadConvos();
    renderHeader();
  } catch (err) {
    formError(form, err.message);
  }
});

$('leave-group').onclick = async () => {
  if (!confirm(t('leaveConfirm'))) return;
  try {
    await api(`/api/convos/${current}/members/me`, { method: 'DELETE' });
    $('group-dialog').close();
    await loadConvos();
    history.back(); // sohbetten çıkıp listeye döner
  } catch (err) {
    formError($('group-form'), err.message);
  }
};

const classOptions = (select) => select.replaceChildren(...me.classes.map((c) => h('option', { value: c.id, textContent: c.name })));
const gradeChoices = () => [...new Set([9, 10, 11, 12, ...me.classes.map((c) => c.grade)])].sort((a, z) => a - z);
const gradeOptions = (select) => select.replaceChildren(...gradeChoices().map((g) => h('option', { value: g, textContent: t('gradeN', { grade: g }) })));

// ---- Ödevler
let homework = [];

async function loadHomework() {
  try {
    homework = await api('/api/homework');
    $('homework-error').textContent = '';
    renderHomework();
  } catch (err) {
    $('homework-error').textContent = err.message;
  }
}

function homeworkEl(hw) {
  const days = daysUntil(hw.due);
  const when = days < 0 ? t('dueOver') : days === 0 ? t('dueToday') : days === 1 ? t('dueTomorrow') : t('dueIn', { count: days });
  const state = days < 0 ? 'over' : days <= 1 ? 'soon' : '';
  return h('li', { className: `card hw ${state}` },
    h('div', { className: 'card-top' },
      h('span', { className: 'chip', textContent: hw.subject }),
      h('span', { className: 'due' }, icon('calendar'), `${dateLabel(hw.due)} · ${when}`)),
    h('p', { className: 'card-title', textContent: hw.title }),
    hw.body ? h('p', { className: 'card-body', textContent: hw.body }) : '',
    h('div', { className: 'card-foot' },
      h('span', { textContent: isTeacher() ? `${hw.className} · ${hw.teacherName}` : hw.teacherName }),
      hw.teacherId === me.id ? deleteButton(() => deleteHomework(hw)) : ''));
}

function renderHomework() {
  const upcoming = homework.filter((x) => daysUntil(x.due) >= 0);
  const past = homework.filter((x) => daysUntil(x.due) < 0).reverse();
  $('homework-list').replaceChildren(...upcoming.map(homeworkEl));
  $('no-homework').hidden = upcoming.length > 0;
  $('homework-past').hidden = !past.length;
  $('homework-past').querySelector('summary').textContent = `${t('pastHomework')} (${past.length})`;
  $('homework-past-list').replaceChildren(...past.map(homeworkEl));
}

async function deleteHomework(hw) {
  if (!confirm(t('deleteHomeworkConfirm'))) return;
  try {
    await api(`/api/homework/${hw.id}`, { method: 'DELETE' });
    loadHomework();
  } catch (err) {
    $('homework-error').textContent = err.message;
  }
}

$('new-homework').onclick = () => {
  const form = $('homework-form');
  form.reset();
  formError(form, '');
  classOptions(form.elements.classId);
  form.elements.due.min = todayIso();
  $('homework-dialog').showModal();
};

$('homework-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = form.elements;
  try {
    const hw = await api('/api/homework', {
      method: 'POST',
      json: { classId: Number(f.classId.value), subject: f.subject.value, title: f.title.value, body: f.body.value, due: f.due.value },
    });
    // Duyuru sınıf grubuna normal mesaj olarak gider; böylece herkese bildirim de ulaşır.
    if (f.announce.checked) {
      const cls = me.classes.find((c) => c.id === hw.classId);
      const body = t('hwAnnouncement', { subject: hw.subject, title: hw.title, due: dateLabel(hw.due) });
      await api(`/api/convos/${cls.convoId}/messages`, { method: 'POST', json: { body } }).catch(() => {});
    }
    $('homework-dialog').close();
    loadHomework();
  } catch (err) {
    formError(form, err.message);
  }
});

// ---- Yönetim paneli: kayıt kodları, sınıflar, kişiler
const ADMIN_PAGE = 50; // okulun tamamı listelenmez; arama daraltır
let admin = null; // { classes, users }
let managed = null; // penceresi açık olan kişi

async function loadAdmin() {
  try {
    admin = await api('/api/admin');
    $('admin-error').textContent = '';
    renderAdmin();
  } catch (err) {
    $('admin-error').textContent = err.message;
  }
}

const roleLabel = (u) => (u.admin ? t('admin') : t(u.role));
const classList = (value) => value.split(',').map((c) => c.trim()).filter(Boolean);

function renderAdmin() {
  $('no-classes').hidden = admin.classes.length > 0;
  // Sınıfa dokununca kişiler o sınıfa göre süzülür.
  $('admin-classes').replaceChildren(...admin.classes.map((c) => h('li', {}, h('button', {
    type: 'button',
    textContent: t('classCount', { name: c.name, students: c.students, teachers: c.teachers }),
    onclick: () => {
      $('admin-search').value = c.name;
      renderAdmin();
    },
  }))));
  const query = $('admin-search').value.trim().toLocaleLowerCase(locale());
  const found = admin.users.filter((u) => `${u.name} @${u.username} ${u.classes}`.toLocaleLowerCase(locale()).includes(query));
  $('admin-users').replaceChildren(...found.slice(0, ADMIN_PAGE).map((u) =>
    h('li', {}, h('button', { type: 'button', className: 'person-row', onclick: () => openPerson(u) },
      avatar(u.name, u.id),
      h('span', {},
        h('strong', { textContent: u.id === me.id ? `${u.name} (${t('you')})` : u.name }),
        h('small', { textContent: [`@${u.username}`, roleLabel(u), u.classes].filter(Boolean).join(' · ') }))))));
  $('admin-more').hidden = found.length <= ADMIN_PAGE;
  $('admin-more').textContent = t('morePeople', { count: found.length - ADMIN_PAGE });
}
$('admin-search').oninput = renderAdmin;

$('invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = form.elements;
  formError(form, '');
  try {
    const made = await api('/api/admin/invites', { method: 'POST', json: { role: f.role.value, classes: classList(f.classes.value), count: Number(f.count.value) } });
    $('invite-codes').value = made.map((m) => `${m.code}   ${m.link}`).join('\n');
    $('invite-copy').textContent = t('copy');
    $('invite-result').hidden = false;
    loadAdmin(); // yeni açılan sınıf listede görünsün
  } catch (err) {
    formError(form, err.message);
  }
});
$('invite-copy').onclick = () => navigator.clipboard.writeText($('invite-codes').value)
  .then(() => { $('invite-copy').textContent = t('copied'); }, () => $('invite-codes').select());

function openPerson(u) {
  managed = u;
  const form = $('person-form');
  formError(form, '');
  $('person-name').textContent = u.name;
  $('person-sub').textContent = `@${u.username} · ${roleLabel(u)}`;
  form.elements.classes.value = u.classes;
  $('person-password').hidden = true;
  // Kendi şifresini ve hesabını Profil'den yönetir.
  $('person-reset').hidden = $('person-remove').hidden = u.id === me.id;
  $('person-dialog').showModal();
}

$('person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/users/${managed.id}/classes`, { method: 'PUT', json: { classes: classList(e.target.elements.classes.value) } });
    if (managed.id === me.id) me = await api('/api/me');
    $('person-dialog').close();
    loadAdmin();
  } catch (err) {
    formError(e.target, err.message);
  }
});

$('person-reset').onclick = async () => {
  if (!confirm(t('resetConfirm', { name: managed.name }))) return;
  try {
    const { password } = await api(`/api/admin/users/${managed.id}/reset`, { method: 'POST' });
    $('person-password').textContent = t('tempPassword', { password });
    $('person-password').hidden = false;
  } catch (err) {
    formError($('person-form'), err.message);
  }
};

$('person-remove').onclick = async () => {
  if (!confirm(t('removeConfirm', { name: managed.name }))) return;
  try {
    await api(`/api/admin/users/${managed.id}`, { method: 'DELETE' });
    $('person-dialog').close();
    loadAdmin();
  } catch (err) {
    formError($('person-form'), err.message);
  }
};

// ---- Yazılıya hazırlık: ders -> ünite -> sorular
let quiz = null; // { grade, subjects: [{ subject, source, units: [{ name, topics, count }] }] }
let openSubject = null; // ünite listesi açık olan ders
let run = null; // { subject, unit, all, list, index, right, open, lesson, mistakes }

function showQuizPanel(name) {
  for (const panel of ['home', 'units', 'run', 'mistakes']) $(`quiz-${panel}`).hidden = panel !== name;
  $('mistakes-open').hidden = name !== 'home';
  $('view-quiz').scrollTop = 0;
}

async function loadQuiz(grade) {
  const asked = isTeacher() ? grade || quiz?.grade : null;
  try {
    quiz = await api(asked ? `/api/quiz?grade=${asked}` : '/api/quiz');
    $('quiz-error').textContent = '';
    renderSubjects();
    if (openSubject) renderUnits();
  } catch (err) {
    $('quiz-error').textContent = err.message;
  }
}

function renderSubjects() {
  $('quiz-title').textContent = quiz.grade ? t('quizTitle', { grade: quiz.grade }) : t('tabQuiz');
  gradeOptions($('quiz-grade'));
  $('quiz-grade').value = quiz.grade;
  $('no-questions').hidden = quiz.subjects.length > 0;
  $('quiz-subjects').replaceChildren(...quiz.subjects.map((s, i) =>
    h('li', {}, h('button', { type: 'button', className: `subject ${hue(i)}`, onclick: () => openUnits(s.subject) },
      h('strong', { textContent: s.subject }),
      h('span', { textContent: t('subjectStats', { units: s.units.length, count: s.units.reduce((n, u) => n + u.count, 0) }) })))));
}
$('quiz-grade').onchange = () => {
  openSubject = null;
  loadQuiz(Number($('quiz-grade').value));
};

function openUnits(subject) {
  openSubject = subject;
  renderUnits();
  showQuizPanel('units');
}

function renderUnits() {
  const s = quiz.subjects.find((x) => x.subject === openSubject);
  if (!s) {
    openSubject = null;
    return showQuizPanel('home');
  }
  $('units-subject').textContent = s.subject;
  $('units-source').textContent = s.source ? t('sourceLabel', { source: s.source }) : '';
  // Sorusu olmayan ünite görünür ama açılmaz; böylece programın tamamı listede durur.
  $('units-list').replaceChildren(...s.units.map((u, i) =>
    h('li', {}, h('button', { type: 'button', className: 'unit', disabled: !u.count, onclick: () => openUnit(s.subject, u.name) },
      h('span', { className: 'unit-no', textContent: i + 1 }),
      h('span', { className: 'unit-text' },
        h('strong', { textContent: u.name || t('otherUnit') }),
        u.topics ? h('small', { textContent: u.topics }) : '',
        u.score ? scoreEl(u.score) : ''),
      h('span', { className: 'unit-count', textContent: u.count ? t('questionsCount', { count: u.count }) : t('comingSoon') })),
    u.lessons ? h('button', { type: 'button', className: 'lesson-link', textContent: t('lessonButton', { count: u.lessons }), onclick: () => openUnit(s.subject, u.name, true) }) : '')));
}
// Yarıdan azı doğruysa ünite zayıf görünür; öğretmen hangi konuya dönmesi gerektiğini görür.
function scoreEl({ correct, total, students }) {
  const pct = Math.round((correct / total) * 100);
  const text = isTeacher() ? t('classScore', { pct, students }) : t('lastScore', { correct, total });
  return h('span', { className: `unit-score${pct < 50 ? ' weak' : ''}`, textContent: text });
}

$('units-back').onclick = () => {
  openSubject = null;
  showQuizPanel('home');
};

async function openUnit(subject, unit, lesson = false) {
  const params = new URLSearchParams({ subject, unit });
  if (isTeacher()) params.set('grade', quiz.grade);
  try {
    const list = await api(`/api/quiz/${lesson ? 'lesson' : 'questions'}?${params}`);
    $('quiz-error').textContent = '';
    if (list.length) startQuiz(subject, unit, list, lesson);
  } catch (err) {
    $('quiz-error').textContent = err.message;
  }
}

// Konu anlatımında her bölüm önce konuyu anlatır, ardından o konudan bir soru sorar; sıra karışmaz, sonuç kaydedilmez.
// Yanlışlarım: derse göre yanlış sayıları; derse dokununca o dersin yanlışları test olarak açılır.
async function openMistakes() {
  try {
    const list = await api('/api/quiz/mistakes');
    $('quiz-error').textContent = '';
    const bySubject = new Map();
    for (const q of list) bySubject.set(q.subject, [...(bySubject.get(q.subject) || []), q]);
    $('no-mistakes').hidden = list.length > 0;
    $('mistakes-subjects').replaceChildren(...[...bySubject].map(([subject, questions], i) =>
      h('li', {}, h('button', { type: 'button', className: `subject ${hue(i)}`, onclick: () => startQuiz(subject, subject, questions, false, true) },
        h('strong', { textContent: subject }),
        h('span', { textContent: t('mistakesCount', { count: questions.length }) })))));
    showQuizPanel('mistakes');
  } catch (err) {
    $('quiz-error').textContent = err.message;
  }
}
$('mistakes-open').onclick = openMistakes;
$('mistakes-back').onclick = () => showQuizPanel('home');

function startQuiz(subject, unit, all, lesson = false, mistakes = false) {
  run = { subject, unit, all, list: lesson ? all : shuffle([...all]).slice(0, QUIZ_SIZE), index: 0, right: 0, open: 0, lesson, mistakes };
  $('quiz-subject').textContent = unit || t('otherUnit');
  showQuizPanel('run');
  renderQuestion();
}

function endQuiz() {
  const { mistakes } = run;
  run = null;
  if (mistakes) return openMistakes();
  showQuizPanel(openSubject ? 'units' : 'home');
  loadQuiz();
}
$('quiz-back').onclick = endQuiz;

function renderQuestion() {
  const q = run.list[run.index];
  const total = run.list.length;
  $('quiz-progress').textContent = t(run.lesson ? 'topicOf' : 'questionOf', { n: run.index + 1, total });
  $('quiz-bar').style.width = `${(run.index / total) * 100}%`;
  $('view-quiz').scrollTop = 0;
  const feedback = h('p', { className: 'feedback', hidden: true });
  const explain = h('div', { className: 'explain', hidden: true });
  const next = h('button', { type: 'button', className: 'primary', textContent: t(run.index + 1 < total ? (run.lesson ? 'nextTopic' : 'next') : 'finish'), hidden: true, onclick: nextQuestion });
  const reveal = (title) => {
    if (q.explain) {
      explain.replaceChildren(h('strong', { textContent: t(title) }), q.explain);
      explain.hidden = false;
    }
    next.hidden = false;
    next.focus();
  };
  const parts = [h('p', { className: 'quiz-q', textContent: q.q })];
  if (q.text) {
    parts.unshift(h('div', { className: 'lesson' }, h('h3', { textContent: q.title }),
      ...q.text.split('\n\n').map((p) => h('p', { textContent: p }))), h('p', { className: 'hint', textContent: t('lessonCheck') }));
  }
  if (q.choices) {
    const buttons = q.choices.map((choice, i) => h('button', { type: 'button', className: 'choice' },
      h('span', { className: 'letter', textContent: LETTERS[i] }), h('span', { textContent: choice })));
    buttons.forEach((button, i) => {
      button.onclick = () => {
        for (const b of buttons) b.disabled = true;
        const ok = i === q.answer;
        buttons[q.answer].classList.add('right');
        if (ok) run.right++;
        else button.classList.add('wrong');
        if (!run.lesson && !isTeacher()) api('/api/quiz/mistakes', { method: 'POST', json: { subject: run.subject, q: q.q, ok } }).catch(() => {});
        feedback.className = `feedback ${ok ? 'ok' : 'bad'}`;
        feedback.textContent = ok ? t('correct') : t('wrong', { letter: LETTERS[q.answer] });
        feedback.hidden = false;
        reveal('explanationTitle');
      };
    });
    parts.push(h('div', { className: 'choices' }, ...buttons));
  } else {
    // Açık uçlu: öğrenci cevabını yazar, sonra örnek cevapla kendisi karşılaştırır.
    parts.push(h('textarea', { rows: 3, maxLength: 2000, placeholder: t('yourAnswer'), ariaLabel: t('yourAnswer') }));
    const show = h('button', { type: 'button', textContent: t('showAnswer') });
    show.onclick = () => {
      show.hidden = true;
      run.open++;
      reveal('modelAnswer');
    };
    parts.push(h('div', { className: 'quiz-actions' }, show));
  }
  const actions = h('div', { className: 'quiz-actions' });
  if (q.teacherId === me.id) {
    actions.append(h('span', { className: 'chip mine-tag', textContent: t('yourQuestion') }),
      h('button', { type: 'button', className: 'danger', textContent: t('delete'), onclick: () => deleteQuestion(q) }));
  }
  actions.append(next);
  $('quiz-card').replaceChildren(...parts, feedback, explain, actions);
}

function nextQuestion() {
  run.index++;
  if (run.index < run.list.length) return renderQuestion();
  $('quiz-bar').style.width = '100%';
  $('quiz-progress').textContent = '';
  const multiple = run.list.filter((q) => q.choices).length;
  const result = h('div', { className: 'result' });
  if (multiple) {
    result.append(h('p', { className: 'score', textContent: `${run.right}/${multiple}` }),
      h('p', { textContent: t('resultScore', { right: run.right, total: multiple }) }));
  }
  if (run.open) result.append(h('p', { className: 'hint', textContent: t('resultOpen', { count: run.open }) }));
  const { subject, unit, all, lesson, mistakes } = run;
  if (mistakes) {
    result.append(h('div', { className: 'quiz-actions' }, h('button', { type: 'button', className: 'primary', textContent: t('backToMistakes'), onclick: endQuiz })));
    return $('quiz-card').replaceChildren(result);
  }
  if (multiple && !isTeacher() && !lesson) {
    api('/api/quiz/results', { method: 'POST', json: { subject, unit, correct: run.right, total: multiple } })
      .catch((err) => { $('quiz-error').textContent = err.message; });
  }
  result.append(h('div', { className: 'quiz-actions' },
    h('button', { type: 'button', textContent: t('backToUnits'), onclick: endQuiz }),
    lesson ? h('button', { type: 'button', textContent: t('tryAgain'), onclick: () => startQuiz(subject, unit, all, true) }) : '',
    h('button', { type: 'button', className: 'primary', textContent: t(lesson ? 'unitTest' : 'tryAgain'),
      onclick: () => (lesson ? openUnit(subject, unit) : startQuiz(subject, unit, all)) })));
  $('quiz-card').replaceChildren(result);
}

async function deleteQuestion(q) {
  if (!confirm(t('deleteQuestionConfirm'))) return;
  try {
    await api(`/api/quiz/${q.id}`, { method: 'DELETE' });
  } catch (err) {
    $('quiz-error').textContent = err.message;
  }
  endQuiz();
}

// Doğru şık seçeneği, yalnızca doldurulmuş şıklar arasından seçilebilir.
function updateAnswerOptions() {
  const form = $('question-form');
  const filled = [...form.querySelectorAll('[name=choice]')].map((input, i) => [input.value.trim(), i]).filter(([v]) => v);
  const select = form.elements.answer;
  const previous = select.value;
  select.replaceChildren(...filled.map(([, i]) => h('option', { value: i, textContent: LETTERS[i] })));
  if (filled.some(([, i]) => String(i) === previous)) select.value = previous;
  $('answer-field').hidden = !filled.length;
  form.elements.explain.required = !filled.length;
}
$('question-form').addEventListener('input', (e) => { if (e.target.name === 'choice') updateAnswerOptions(); });

// Ünite önerileri seçilen derse göre değişir; öğretmen listede olmayan bir ünite de yazabilir.
function fillUnitList() {
  const subject = quiz?.subjects.find((s) => s.subject === $('question-form').elements.subject.value.trim());
  $('quiz-unit-list').replaceChildren(...(subject?.units || []).map((u) => h('option', { value: u.name })));
}
$('question-form').elements.subject.addEventListener('input', fillUnitList);

function openQuestionDialog() {
  if (!quiz) return;
  const form = $('question-form');
  form.reset();
  formError(form, '');
  $('question-grade').textContent = t('questionForGrade', { grade: quiz.grade });
  const subjects = [...new Set([...quiz.subjects.map((s) => s.subject), ...SUBJECTS])];
  $('quiz-subject-list').replaceChildren(...subjects.map((s) => h('option', { value: s })));
  form.elements.subject.value = openSubject || '';
  fillUnitList();
  updateAnswerOptions();
  $('question-dialog').showModal();
}
$('new-question').onclick = openQuestionDialog;
$('new-question-unit').onclick = openQuestionDialog;

$('question-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = form.elements;
  // Arada boş şık bırakıldıysa şıklar sıkıştırılır; doğru cevap aynı metni göstermeye devam eder.
  const kept = [...form.querySelectorAll('[name=choice]')].map((input, i) => [input.value.trim(), i]).filter(([v]) => v);
  const json = { grade: quiz.grade, subject: f.subject.value, unit: f.unit.value, q: f.q.value, explain: f.explain.value };
  if (kept.length) {
    json.choices = kept.map(([v]) => v);
    json.answer = kept.findIndex(([, i]) => i === Number(f.answer.value));
  }
  try {
    await api('/api/quiz', { method: 'POST', json });
    $('question-dialog').close();
    loadQuiz(quiz.grade);
  } catch (err) {
    formError(form, err.message);
  }
});

// ---- Gelişim notları
let notes = [];

async function loadNotes() {
  $('notes-help').textContent = t(isTeacher() ? 'notesHelpTeacher' : 'notesHelpStudent');
  try {
    notes = await api('/api/notes');
    $('notes-error').textContent = '';
    $('notes-list').replaceChildren(...notes.map(noteEl));
    $('no-notes').hidden = notes.length > 0;
  } catch (err) {
    $('notes-error').textContent = err.message;
  }
}

function noteEl(n) {
  const who = isTeacher() ? [n.studentName, n.className].filter(Boolean).join(' · ') : n.teacherName;
  return h('li', { className: `card note lvl${n.level}` },
    h('div', { className: 'card-top' },
      h('span', { className: 'chip', textContent: n.subject }),
      h('span', { className: 'level-chip', textContent: t(`level${n.level}`) }),
      h('time', { textContent: new Date(n.at).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })),
    h('p', { className: 'card-body', textContent: n.body }),
    h('div', { className: 'card-foot' },
      h('span', { textContent: who }),
      n.teacherId === me.id ? deleteButton(() => deleteNote(n)) : ''));
}

async function deleteNote(n) {
  if (!confirm(t('deleteNoteConfirm'))) return;
  try {
    await api(`/api/notes/${n.id}`, { method: 'DELETE' });
    loadNotes();
  } catch (err) {
    $('notes-error').textContent = err.message;
  }
}

// Öğrenci listesi sınıf grubunun üyelerinden gelir.
function fillStudents() {
  const form = $('note-form');
  const convo = convos.find((c) => c.classId === Number(form.elements.classId.value));
  const students = (convo?.members || []).filter((m) => m.role === 'student').sort((a, z) => a.name.localeCompare(z.name, locale()));
  form.elements.studentId.replaceChildren(...students.map((s) => h('option', { value: s.id, textContent: s.name })));
  $('no-students').hidden = students.length > 0;
}
$('note-form').elements.classId.addEventListener('change', fillStudents);

$('new-note').onclick = async () => {
  const form = $('note-form');
  form.reset();
  formError(form, '');
  await loadConvos().catch(() => {}); // yeni katılan öğrenciler de listede olsun
  classOptions(form.elements.classId);
  fillStudents();
  $('note-dialog').showModal();
};

$('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = form.elements;
  try {
    await api('/api/notes', {
      method: 'POST',
      json: { studentId: Number(f.studentId.value), subject: f.subject.value, level: Number(f.level.value), body: f.body.value },
    });
    $('note-dialog').close();
    loadNotes();
  } catch (err) {
    formError(form, err.message);
  }
});

// ---- Görünüm: tema, renk, sohbet arka planı ve yazı boyutu bu cihazda saklanır (look.js).
function applyWall() {
  let photo = null;
  try {
    photo = localStorage.getItem(WALL_KEY);
  } catch {}
  if (look.wall === 'photo' && !photo) look.wall = 'school';
  const chat = $('chat-open');
  chat.classList.remove(...[...chat.classList].filter((c) => c.startsWith('wall-')));
  chat.classList.add(`wall-${look.wall}`);
  for (const el of [chat, $('wall-photo-tile')]) {
    if (photo) el.style.setProperty('--wall-photo', `url("${photo}")`);
    else el.style.removeProperty('--wall-photo');
  }
  $('wall-photo-tile').hidden = !photo;
}

function openLook() {
  const form = $('look-form');
  for (const name of ['theme', 'accent', 'wall', 'size']) form.elements[name].value = look[name];
  $('look-error').textContent = '';
  $('look-dialog').showModal();
}
$('open-look').onclick = openLook;
$('profile-look').onclick = () => {
  $('profile-dialog').close();
  openLook();
};

$('look-form').addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (!['theme', 'accent', 'wall', 'size'].includes(name)) return;
  look[name] = value;
  saveLook();
  applyRootLook();
  applyWall();
});

// Fotoğraf küçültülüp yalnızca bu telefonda saklanır; sunucuya gönderilmez.
$('wall-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('look-error').textContent = '';
  try {
    const blob = await shrink(file, 1280, 0.8);
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    localStorage.setItem(WALL_KEY, url);
  } catch {
    $('look-error').textContent = t('wallPhotoFailed');
    return;
  }
  look.wall = 'photo';
  saveLook();
  applyWall();
  $('look-form').elements.wall.value = 'photo';
});

// ---- Profil
$('open-profile').onclick = () => {
  const form = $('profile-form');
  form.reset();
  formError(form, '');
  $('delete-error').textContent = '';
  form.querySelector('.danger-zone').open = false;
  form.elements.name.value = me.name;
  $('profile-username').textContent = `@${me.username}`;
  $('profile-role').replaceChildren(h('span', { className: 'chip', textContent: t(me.role) }),
    ...me.classes.map((c) => h('span', { className: 'chip', textContent: c.name })));
  $('profile-dialog').showModal();
};

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const json = { name: form.elements.name.value };
  if (form.elements.newPassword.value) {
    json.newPassword = form.elements.newPassword.value;
    json.currentPassword = form.elements.currentPassword.value;
  }
  try {
    me = await api('/api/me', { method: 'PATCH', json });
    renderMe();
    $('profile-dialog').close();
    await loadConvos();
  } catch (err) {
    formError(form, err.message);
  }
});

$('logout').onclick = async () => {
  try {
    await disablePush().catch((err) => console.error(err));
    await api('/api/logout', { method: 'POST' });
    $('profile-dialog').close();
    showAuth();
  } catch (err) {
    formError($('profile-form'), err.message);
  }
};

$('delete-account').onclick = async () => {
  $('delete-error').textContent = '';
  if (!confirm(t('deleteConfirm'))) return;
  try {
    await api('/api/me', { method: 'DELETE', json: { password: $('delete-password').value } });
  } catch (err) {
    $('delete-error').textContent = err.message;
    return;
  }
  // Sunucu bildirim kaydını zaten sildi; telefondaki abonelik de kapansın.
  await pushSubscription().then((s) => s?.unsubscribe()).catch(() => {});
  $('profile-dialog').close();
  showAuth();
};

// ---- Dil
for (const button of document.querySelectorAll('.lang-toggle')) {
  button.onclick = () => {
    setLang(lang === 'en' ? 'tr' : 'en');
    translatePage();
    for (const error of document.querySelectorAll('.error')) error.textContent = '';
    if (!me) return;
    renderConvos();
    if (current) openConvo(current, false);
    if (tab !== 'chats') showTab(tab);
    if (quiz && !run) renderSubjects();
    // Bildirim yazısı da yeni dile geçsin.
    if (pushSupported && Notification.permission === 'granted') subscribePush().catch((err) => console.error(err));
  };
}

// ---- Başlangıç
translatePage();
applyWall();
$('subjects').replaceChildren(...SUBJECTS.map((s) => h('option', { value: s })));
updateSendButtons();
fetch('/api/me')
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null)
  .then((user) => (user ? showApp(user) : showAuth()));
