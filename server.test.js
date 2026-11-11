'use strict';
// Sunucuyu gerçek süreç olarak başlatıp dışarıdan, HTTP üzerinden sınar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educom-'));
const PORT = 34581;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_PUSH = 'http://127.0.0.1:34584';
const env = { ...process.env, DATA_DIR: dir, PORT: String(PORT), BASE_URL: BASE, PUSH_ORIGINS: FAKE_PUSH };
const pushHits = [];
let pushStatus = 201;
const fakePush = require('node:http').createServer((req, res) => {
  pushHits.push({ url: req.url, headers: req.headers });
  res.writeHead(pushStatus).end();
});
const cli = (...args) => execFileSync(process.execPath, ['server.js', ...args], { cwd: __dirname, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PASSWORD = 'parola-1234';
let server;

async function call(url, { cookie, json, body, method, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method: method || (json !== undefined || body ? 'POST' : 'GET'),
    headers: { ...(cookie && { Cookie: cookie }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const set = res.headers.get('set-cookie');
  const isJson = (res.headers.get('content-type') || '').includes('json');
  return { status: res.status, cookie: set && set.split(';')[0], data: isJson ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

const codes = (...args) => [...cli('invite', ...args).matchAll(/#invite=([A-Z0-9]+)/g)].map((m) => m[1]);
const register = async (username, role = 'student', ...classes) => {
  const [code] = codes(role, ...(classes.length ? classes : ['9-A']));
  const r = await call('/api/register', { json: { invite: code, username, name: username, password: PASSWORD } });
  assert.equal(r.status, 200);
  return { ...r.data, cookie: r.cookie };
};

let ali, ayse, can, veli, hoca, hoca2, dm, class9a;

before(async () => {
  await new Promise((r) => fakePush.listen(34584, '127.0.0.1', r));
  server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (await fetch(BASE).then(() => true, () => false)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  ali = await register('ali');
  ayse = await register('ayse', 'teacher', '9-A');
  can = await register('can');
  veli = await register('veli', 'student', '10-B');
  hoca = await register('hoca', 'teacher', '9-A', '10-B');
  hoca2 = await register('hoca2', 'teacher', '11-C');
  class9a = hoca.classes.find((c) => c.name === '9-A');
  dm = (await call('/api/convos', { cookie: ali.cookie, json: { userIds: [ayse.id] } })).data.id;
});

after(() => {
  server.kill();
  fakePush.closeAllConnections();
  fakePush.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kayıt için geçerli ve kullanılmamış kod gerekir', async () => {
  const account = { username: 'yabanci', name: 'Y', password: PASSWORD };
  assert.equal((await call('/api/register', { json: { ...account, invite: 'yanlis' } })).status, 403);
  const [code] = codes('student', '9-A');
  assert.equal((await call('/api/register', { json: { ...account, invite: code } })).status, 200);
  const again = await call('/api/register', { json: { ...account, username: 'yabanci2', invite: code } });
  assert.equal(again.status, 403);
});

test('alınmış kullanıcı adı kodu harcamaz', async () => {
  const [code] = codes('student', '9-A');
  const body = { invite: code, name: 'A', password: PASSWORD };
  assert.equal((await call('/api/register', { json: { ...body, username: 'ALI' } })).status, 409);
  assert.equal((await call('/api/register', { json: { ...body, username: 'ali2' } })).status, 200);
});

test('öğretmen kodu O ile başlar; rol ve sınıflar koddan gelir, kod elle yazılabilir', async () => {
  const [teacherCode] = codes('teacher', '12-a', '9a');
  assert.match(teacherCode, /^O[A-Z2-9]{9}$/);
  const studentCodes = codes('student', '12-A', '5');
  assert.equal(studentCodes.length, 5);
  for (const c of studentCodes) assert.match(c, /^[A-NP-Z2-9]{10}$/); // O hiç yok
  // Küçük harf, tire ve O yerine sıfır yazılsa da kabul edilir.
  const typed = `${teacherCode.slice(0, 5).toLowerCase().replace('o', '0')}-${teacherCode.slice(5)}`;
  const t = await call('/api/register', { json: { invite: typed, username: 'mudur', name: 'Müdür Yrd', password: PASSWORD } });
  assert.equal(t.status, 200);
  assert.equal(t.data.role, 'teacher');
  assert.deepEqual(t.data.classes.map((c) => c.name), ['9-A', '12-A']);
  const s = await call('/api/register', { json: { invite: studentCodes[0], username: 'onikinci', name: 'O', password: PASSWORD } });
  assert.equal(s.data.role, 'student');
  assert.deepEqual(s.data.classes.map((c) => c.name), ['12-A']);
  assert.throws(() => cli('invite', 'student', 'yanlis-sinif'));
  assert.throws(() => cli('invite', 'student', '9-A', '10-B')); // öğrencinin tek sınıfı olur
  assert.match(cli('classes'), /9-A: \d+ students, \d+ teachers/);
});

test('sınıf grubuna yalnızca öğretmen yazar; grup değiştirilemez, çıkılamaz', async () => {
  const convoId = class9a.convoId;
  const list = (await call('/api/convos', { cookie: ali.cookie })).data;
  const group = list.find((c) => c.id === convoId);
  assert.equal(group.classId, class9a.id);
  assert.ok(group.members.some((m) => m.id === hoca.id && m.role === 'teacher'));
  assert.equal((await call(`/api/convos/${convoId}/messages`, { cookie: ali.cookie, json: { body: 'x' } })).status, 403);
  assert.equal((await call(`/api/convos/${convoId}/images`, { cookie: ali.cookie, body: PNG })).status, 403);
  assert.equal((await call(`/api/convos/${convoId}/typing`, { cookie: ali.cookie, json: {} })).status, 403);
  const sent = await call(`/api/convos/${convoId}/messages`, { cookie: hoca.cookie, json: { body: 'Yarın sınav var' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.role, 'teacher');
  const seen = await call(`/api/convos/${convoId}/messages`, { cookie: ali.cookie });
  assert.equal(seen.data.at(-1).body, 'Yarın sınav var');
  // Başka sınıfın öğrencisi göremez.
  assert.equal((await call(`/api/convos/${convoId}/messages`, { cookie: veli.cookie })).status, 404);
  for (const cookie of [ali.cookie, hoca.cookie]) {
    assert.equal((await call(`/api/convos/${convoId}`, { cookie, method: 'PATCH', json: { title: 'x' } })).status, 400);
    assert.equal((await call(`/api/convos/${convoId}/members/me`, { cookie, method: 'DELETE' })).status, 400);
    assert.equal((await call(`/api/convos/${convoId}/members`, { cookie, json: { userIds: [veli.id] } })).status, 400);
  }
});

test('ödev: öğretmen yalnızca kendi sınıfına verir, yalnızca o sınıf görür', async () => {
  const homework = { classId: class9a.id, subject: 'Matematik', title: 'Sayfa 45-47', body: 'Tüm sorular', due: '2099-01-15' };
  assert.equal((await call('/api/homework', { cookie: ali.cookie, json: homework })).status, 403);
  const other = (await call('/api/me', { cookie: hoca2.cookie })).data.classes[0];
  assert.equal((await call('/api/homework', { cookie: hoca.cookie, json: { ...homework, classId: other.id } })).status, 404);
  for (const due of ['2099-02-30', '15.01.2099', '']) {
    assert.equal((await call('/api/homework', { cookie: hoca.cookie, json: { ...homework, due } })).status, 400, due);
  }
  assert.equal((await call('/api/homework', { cookie: hoca.cookie, json: { ...homework, title: ' ' } })).status, 400);
  const made = await call('/api/homework', { cookie: hoca.cookie, json: homework });
  assert.equal(made.status, 200);
  assert.equal(made.data.className, '9-A');
  assert.equal(made.data.teacherName, 'hoca');
  const has = async (cookie) => (await call('/api/homework', { cookie })).data.some((x) => x.id === made.data.id);
  assert.ok(await has(ali.cookie));
  assert.ok(await has(hoca.cookie));
  assert.ok(!(await has(veli.cookie)));
  assert.ok(!(await has(hoca2.cookie)));
  // Eski ödevler listeden düşer.
  const old = await call('/api/homework', { cookie: hoca.cookie, json: { ...homework, due: '2000-01-01' } });
  assert.ok(!(await call('/api/homework', { cookie: ali.cookie })).data.some((x) => x.id === old.data.id));
  assert.equal((await call(`/api/homework/${made.data.id}`, { cookie: hoca2.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await call(`/api/homework/${made.data.id}`, { cookie: ali.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await call(`/api/homework/${made.data.id}`, { cookie: hoca.cookie, method: 'DELETE' })).status, 200);
  assert.ok(!(await has(ali.cookie)));
});

test('gelişim notu: yalnızca kendi sınıfındaki öğrenciye; yalnızca o öğrenci görür ve bildirim alır', async () => {
  const note = { studentId: ali.id, subject: 'Fizik', level: 3, body: 'Derse katılımın çok iyi.' };
  assert.equal((await call('/api/notes', { cookie: can.cookie, json: note })).status, 403);
  assert.equal((await call('/api/notes', { cookie: hoca2.cookie, json: note })).status, 404); // ali hoca2'nin sınıfında değil
  assert.equal((await call('/api/notes', { cookie: hoca.cookie, json: { ...note, studentId: hoca2.id } })).status, 404);
  assert.equal((await call('/api/notes', { cookie: hoca.cookie, json: { ...note, level: 7 } })).status, 400);
  assert.equal((await call('/api/push', { cookie: ali.cookie, json: { endpoint: `${FAKE_PUSH}/ali-not` } })).status, 200);
  pushHits.length = 0;
  const made = await call('/api/notes', { cookie: hoca.cookie, json: note });
  assert.equal(made.status, 200);
  assert.equal(made.data.className, '9-A');
  for (let i = 0; i < 100 && !pushHits.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(pushHits.map((x) => x.url), ['/ali-not']);
  await call('/api/push', { cookie: ali.cookie, method: 'DELETE', json: { endpoint: `${FAKE_PUSH}/ali-not` } });
  const notesOf = async (cookie) => (await call('/api/notes', { cookie })).data;
  assert.equal((await notesOf(ali.cookie))[0].body, 'Derse katılımın çok iyi.');
  assert.equal((await notesOf(can.cookie)).length, 0);
  assert.equal((await notesOf(hoca.cookie))[0].studentName, 'ali');
  assert.equal((await notesOf(hoca2.cookie)).length, 0);
  // 10-B'deki öğrenciye de yazabilir; not silinebilir ama yalnızca yazan öğretmen tarafından.
  const toVeli = await call('/api/notes', { cookie: hoca.cookie, json: { ...note, studentId: veli.id } });
  assert.equal(toVeli.status, 200);
  assert.equal((await call(`/api/notes/${toVeli.data.id}`, { cookie: veli.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await call(`/api/notes/${toVeli.data.id}`, { cookie: hoca.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await notesOf(veli.cookie)).length, 0);
});

test('yazılı hazırlık: ders -> ünite -> soru; öğrenci kendi seviyesini görür, öğretmen soru ekler', async () => {
  const forAli = (await call('/api/quiz?grade=12', { cookie: ali.cookie })).data;
  assert.equal(forAli.grade, 9); // öğrenci başka seviye isteyemez
  const math = forAli.subjects.find((s) => s.subject === 'Matematik');
  assert.deepEqual(math.units.map((u) => u.name).slice(0, 2), ['Sayılar', 'Nicelikler ve Değişimler']);
  assert.match(math.source, /2026-2027/);
  assert.ok(math.units.every((u) => u.count >= 20));
  const unitQuestions = (cookie, subject, unit, grade = '') =>
    call(`/api/quiz/questions?${new URLSearchParams({ subject, unit, grade })}`, { cookie });
  const sayilar = (await unitQuestions(ali.cookie, 'Matematik', 'Sayılar', '12')).data;
  assert.ok(sayilar.length >= 20 && sayilar.every((q) => q.grade === 9 && q.unit === 'Sayılar'));
  assert.equal((await call('/api/quiz?grade=12', { cookie: hoca.cookie })).data.grade, 12);
  assert.equal((await call('/api/quiz', { cookie: veli.cookie })).data.grade, 10);

  const question = { grade: 9, subject: 'Matematik', unit: 'Sayılar', q: 'Boş kümenin alt küme sayısı kaçtır?', choices: ['0', '1', '2'], answer: 1, explain: '2⁰ = 1' };
  assert.equal((await call('/api/quiz', { cookie: ali.cookie, json: question })).status, 403);
  for (const bad of [{ answer: 3 }, { answer: '1' }, { choices: ['tek'], answer: 0 }, { choices: ['a', ''], answer: 0 }, { grade: 13 }, { unit: ' ' }]) {
    assert.equal((await call('/api/quiz', { cookie: hoca.cookie, json: { ...question, ...bad } })).status, 400, JSON.stringify(bad));
  }
  // Açık uçlu soruda örnek cevap zorunlu.
  const open = { grade: 9, subject: 'Tarih', unit: 'Orta Çağ Medeniyetleri', q: 'Kavimler Göçü neden önemlidir?' };
  assert.equal((await call('/api/quiz', { cookie: hoca.cookie, json: open })).status, 400);
  assert.equal((await call('/api/quiz', { cookie: hoca.cookie, json: { ...open, explain: 'Avrupa’nın siyasi haritası değişti.' } })).status, 200);
  const before = math.units[0].count;
  const made = await call('/api/quiz', { cookie: hoca.cookie, json: question });
  assert.equal(made.status, 200);
  const after = (await call('/api/quiz', { cookie: ali.cookie })).data.subjects.find((s) => s.subject === 'Matematik').units[0].count;
  assert.equal(after, before + 1);
  const seen = (await unitQuestions(ali.cookie, 'Matematik', 'Sayılar')).data.find((q) => q.id === made.data.id);
  assert.deepEqual(seen.choices, ['0', '1', '2']);
  assert.equal(seen.teacherId, hoca.id);
  // Programda olmayan bir ünite de açılabilir; listenin sonuna eklenir.
  await call('/api/quiz', { cookie: hoca.cookie, json: { ...question, subject: 'Felsefe', unit: 'Bilgi Felsefesi' } });
  const felsefe = (await call('/api/quiz', { cookie: ali.cookie })).data.subjects.at(-1);
  assert.deepEqual([felsefe.subject, felsefe.units[0].name, felsefe.units[0].count], ['Felsefe', 'Bilgi Felsefesi', 1]);
  assert.ok(!(await unitQuestions(veli.cookie, 'Matematik', 'Sayılar')).data.some((q) => q.id === made.data.id));
  assert.equal((await call(`/api/quiz/${made.data.id}`, { cookie: hoca2.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await call(`/api/quiz/${made.data.id}`, { cookie: hoca.cookie, method: 'DELETE' })).status, 200);
});

test('sınav sonucu: öğrenci kaydeder, ünitede son denemesini görür; öğretmen yalnızca kendi sınıflarını görür', async () => {
  const save = (cookie, body) => call('/api/quiz/results', { cookie, json: { subject: 'Matematik', unit: 'Sayılar', ...body } });
  const sayilar = async (cookie, grade = '') =>
    (await call(`/api/quiz?grade=${grade}`, { cookie })).data.subjects.find((s) => s.subject === 'Matematik').units.find((u) => u.name === 'Sayılar');
  assert.equal((await save(hoca.cookie, { correct: 1, total: 2 })).status, 403);
  for (const bad of [{ correct: 3, total: 2 }, { correct: 0, total: 0 }, { correct: 1, total: 999 }, { correct: '1', total: 2 }, { unit: 'Yok', correct: 1, total: 2 }]) {
    assert.equal((await save(ali.cookie, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await save(ali.cookie, { correct: 2, total: 10 })).status, 200);
  assert.equal((await save(ali.cookie, { correct: 8, total: 10 })).status, 200);
  assert.equal((await save(can.cookie, { correct: 4, total: 10 })).status, 200);
  assert.deepEqual((await sayilar(ali.cookie)).score, { correct: 8, total: 10, students: 1 }); // son deneme
  assert.deepEqual((await sayilar(hoca.cookie, 9)).score, { correct: 12, total: 20, students: 2 });
  assert.equal((await sayilar(hoca2.cookie, 9)).score, undefined); // 11-C öğretmeni 9-A'yı görmez
});

test('yanlışlarım: yanlış cevap listeye girer, doğru cevap çıkarır; herkes yalnızca kendi yanlışlarını görür', async () => {
  const mark = (cookie, body) => call('/api/quiz/mistakes', { cookie, json: body });
  const mine = async (cookie) => (await call('/api/quiz/mistakes', { cookie })).data;
  const { subject, units } = (await call('/api/quiz', { cookie: ali.cookie })).data.subjects[0];
  const [q] = (await call(`/api/quiz/questions?${new URLSearchParams({ subject, unit: units[0].name })}`, { cookie: ali.cookie })).data.filter((x) => x.choices);
  assert.equal((await mark(hoca.cookie, { subject, q: q.q, ok: false })).status, 403);
  assert.equal((await mark(ali.cookie, { subject, q: 'böyle bir soru yok', ok: false })).status, 400);
  await mark(ali.cookie, { subject, q: q.q, ok: false });
  await mark(ali.cookie, { subject, q: q.q, ok: false }); // aynı soru iki kez sayılmaz
  assert.deepEqual((await mine(ali.cookie)).map((x) => [x.subject, x.q]), [[subject, q.q]]);
  assert.deepEqual(await mine(can.cookie), []);
  await mark(ali.cookie, { subject, q: q.q, ok: true });
  assert.deepEqual(await mine(ali.cookie), []);
});

// Soruları tamamlanan sınıflar; yeni sınıf bitince listeye eklenir.
const COMPLETE_GRADES = [9, 10, 11, 12];

test('soru bankası: dosyalar geçerli, ünite adları tekil, 9. sınıfta ünite başına 20, 10. sınıfta ders başına 140, 11-12. sınıflarda 70 soru', () => {
  const dirPath = path.join(__dirname, 'questions');
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 32);
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
    assert.ok([9, 10, 11, 12].includes(data.grade) && data.subject && data.source && data.units.length, file);
    assert.equal(new Set(data.units.map((u) => u.name)).size, data.units.length, file);
    const total = data.units.reduce((n, u) => n + u.questions.length, 0);
    if (COMPLETE_GRADES.includes(data.grade) && data.grade > 9) assert.ok(total >= (data.grade === 10 ? 140 : 70), `${file}: ${total} soru`);
    for (const unit of data.units) {
      const label = `${file} / ${unit.name}`;
      if (data.grade === 9) assert.ok(unit.questions.length >= 20, `${label}: ${unit.questions.length} soru`);
      assert.equal(new Set(unit.questions.map((q) => q.q)).size, unit.questions.length, `${label}: aynı soru iki kez`);
      for (const q of unit.questions) {
        const where = `${label}: ${q.q.slice(0, 50)}`;
        assert.ok(q.q && Object.keys(q).every((k) => ['q', 'choices', 'answer', 'explain'].includes(k)), where);
        if (q.choices) {
          assert.ok(q.choices.length >= 2 && q.choices.length <= 5 && q.choices.every(Boolean), where);
          assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length, where);
          assert.equal(new Set(q.choices).size, q.choices.length, where);
        } else {
          assert.ok(q.explain, where);
        }
      }
    }
  }
});

test('konu anlatımı: her sınıfta her ünitede; her bölümde konu ve tek bir çoktan seçmeli soru', async () => {
  for (const file of fs.readdirSync(path.join(__dirname, 'questions')).filter((f) => f.endsWith('.json'))) {
    const { units } = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions', file), 'utf8'));
    const lessons = JSON.parse(fs.readFileSync(path.join(__dirname, 'lessons', file), 'utf8'));
    for (const unit of units) {
      assert.ok(lessons[unit.name]?.length, `${file} / ${unit.name}: konu anlatımı yok`);
      for (const x of lessons[unit.name]) {
        const where = `${file} / ${unit.name} / ${x.title}`;
        assert.ok(Object.keys(x).every((k) => ['title', 'text', 'q', 'choices', 'answer', 'explain'].includes(k)), where);
        assert.ok(x.title && x.text && x.q && x.explain, where);
        assert.ok(x.choices.length >= 2 && x.choices.length <= 5 && new Set(x.choices).size === x.choices.length, where);
        assert.ok(Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.choices.length, where);
      }
    }
  }
  const units = (await call('/api/quiz', { cookie: veli.cookie })).data.subjects.find((s) => s.subject === 'Fizik').units;
  assert.ok(units.every((u) => u.lessons > 0));
  const lesson = (cookie) => call(`/api/quiz/lesson?${new URLSearchParams({ subject: 'Fizik', unit: units[0].name })}`, { cookie });
  const own = (await lesson(veli.cookie)).data;
  assert.equal(own.length, units[0].lessons);
  // Öğrenci başka sınıfın anlatımını isteyemez: grade parametresi yalnızca öğretmende geçerli.
  const askedOther = await call(`/api/quiz/lesson?${new URLSearchParams({ subject: 'Fizik', unit: units[0].name, grade: 9 })}`, { cookie: veli.cookie });
  assert.deepEqual(askedOther.data, own);
});

test('oturumsuz API erişimi reddedilir', async () => {
  for (const url of ['/api/me', '/api/users', '/api/convos', `/api/convos/${dm}/messages`, '/api/events', '/api/homework', '/api/notes', '/api/quiz']) {
    assert.equal((await call(url)).status, 401, url);
  }
});

test('ATICOM çerezi EDUCOM oturumu sayılmaz', async () => {
  const token = /esid=([0-9a-f]{64})/.exec(ali.cookie)[1];
  assert.equal((await call('/api/me', { cookie: `sid=${token}` })).status, 401);
  assert.equal((await call('/api/me', { cookie: ali.cookie })).status, 200);
});

test('yol aşımı ile sunucu dosyaları okunamaz', async () => {
  for (const url of ['/../server.js', '/..%2fserver.js', '/uploads/..%2feducom.db', '/server.js', '/questions/9-matematik.json']) {
    assert.equal((await call(url, { cookie: ali.cookie })).status, 404, url);
  }
});

test('özel sohbet tekildir ve üye olmayan erişemez', async () => {
  const again = await call('/api/convos', { cookie: ayse.cookie, json: { userIds: [ali.id] } });
  assert.equal(again.data.id, dm);
  const sent = await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body: 'selam' } });
  assert.equal(sent.status, 200);
  assert.equal((await call(`/api/convos/${dm}/messages`, { cookie: can.cookie })).status, 404);
  assert.equal((await call(`/api/convos/${dm}/messages`, { cookie: can.cookie, json: { body: 'x' } })).status, 404);
  const list = await call(`/api/convos/${dm}/messages`, { cookie: ayse.cookie });
  assert.equal(list.data.at(-1).body, 'selam');
});

test('öğrenci yalnızca öğretmene yazar; öğrenciler birbirine yazamaz', async () => {
  // Kişi listesinde öğrenci yalnızca öğretmenleri görür; öğretmen herkesi görür.
  const seen = (await call('/api/users', { cookie: ali.cookie })).data;
  assert.ok(seen.length > 0 && seen.every((u) => u.role === 'teacher'));
  assert.ok((await call('/api/users', { cookie: hoca.cookie })).data.some((u) => u.id === can.id));
  // Öğrenci başka öğrenciyle özel sohbet ya da grup açamaz, gruba öğrenci ekleyemez.
  assert.equal((await call('/api/convos', { cookie: ali.cookie, json: { userIds: [can.id] } })).status, 403);
  assert.equal((await call('/api/convos', { cookie: ali.cookie, json: { userIds: [hoca.id, can.id], title: 'x' } })).status, 403);
  const g = (await call('/api/convos', { cookie: ali.cookie, json: { userIds: [hoca.id, hoca2.id], title: 'Danışma' } })).data.id;
  assert.equal((await call(`/api/convos/${g}/members`, { cookie: ali.cookie, json: { userIds: [can.id] } })).status, 403);
  // Öğretmenin içinde birden çok öğrenci olan grubunda öğrenciler yalnızca okur.
  const t = (await call('/api/convos', { cookie: hoca.cookie, json: { userIds: [ali.id, can.id], title: 'Proje' } })).data.id;
  assert.equal((await call(`/api/convos/${t}/messages`, { cookie: hoca.cookie, json: { body: 'duyuru' } })).status, 200);
  assert.equal((await call(`/api/convos/${t}/messages`, { cookie: ali.cookie, json: { body: 'x' } })).status, 403);
  assert.equal((await call(`/api/convos/${t}/images`, { cookie: can.cookie, body: PNG })).status, 403);
  assert.equal((await call(`/api/convos/${t}/messages`, { cookie: can.cookie })).data.at(-1).body, 'duyuru');
});

test('okunmamış sayısı çalışır', async () => {
  const unread = async () => (await call('/api/convos', { cookie: ayse.cookie })).data.find((c) => c.id === dm).unread;
  assert.ok((await unread()) >= 1);
  await call(`/api/convos/${dm}/read`, { cookie: ayse.cookie, method: 'POST' });
  assert.equal(await unread(), 0);
});

test('grup adı ister ve tüm üyelere açılır', async () => {
  const userIds = [ayse.id, hoca.id];
  assert.equal((await call('/api/convos', { cookie: ali.cookie, json: { userIds } })).status, 400);
  const group = await call('/api/convos', { cookie: ali.cookie, json: { userIds, title: 'Proje ödevi' } });
  assert.equal(group.status, 200);
  const seen = await call('/api/convos', { cookie: hoca.cookie });
  assert.equal(seen.data.find((c) => c.id === group.data.id).members.length, 3);
});

test('fotoğraf yalnızca üyelere açılır, zararlı tür reddedilir', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await call(`/api/convos/${dm}/images`, { cookie: ali.cookie, body: svg })).status, 415);
  assert.equal((await call(`/api/convos/${dm}/images`, { cookie: can.cookie, body: PNG })).status, 404);
  const sent = await call(`/api/convos/${dm}/images`, { cookie: ali.cookie, body: PNG });
  assert.equal(sent.status, 200);
  const url = `/uploads/${sent.data.image}`;
  const got = await call(url, { cookie: ayse.cookie });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal((await call(url, { cookie: can.cookie })).status, 404);
  assert.equal((await call(url)).status, 401);
  const voice = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]);
  const sentVoice = await call(`/api/convos/${dm}/images`, { cookie: ali.cookie, body: voice });
  assert.match(sentVoice.data.image, /\.webm$/);
  const gotVoice = await call(`/uploads/${sentVoice.data.image}`, { cookie: ayse.cookie });
  assert.equal(gotVoice.headers.get('content-type'), 'audio/webm');
});

test('yanıt yalnızca aynı sohbetteki mesaja verilir ve alıntıyla döner', async () => {
  const first = await call(`/api/convos/${dm}/messages`, { cookie: ayse.cookie, json: { body: 'soru' } });
  const answer = await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body: 'cevap', replyTo: first.data.id } });
  assert.equal(answer.data.replyId, first.data.id);
  assert.equal(answer.data.replyBody, 'soru');
  assert.equal(answer.data.replyName, 'ayse');
  const other = (await call('/api/convos', { cookie: ali.cookie, json: { userIds: [hoca2.id] } })).data.id;
  const foreign = await call(`/api/convos/${other}/messages`, { cookie: hoca2.cookie, json: { body: 'x', replyTo: first.data.id } });
  assert.equal(foreign.status, 400);
});

test('okundu, yazıyor ve ödev bilgisi canlı akışla gelir', async () => {
  const stream = await fetch(`${BASE}/api/events`, { headers: { Cookie: ali.cookie } });
  const reader = stream.body.getReader();
  let text = '';
  const until = async (needle) => {
    while (!text.includes(needle)) text += Buffer.from((await reader.read()).value).toString();
  };
  await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body: 'okundu-mu' } });
  await call(`/api/convos/${dm}/typing`, { cookie: ayse.cookie, json: { kind: 'voice' } });
  await until('"type":"typing"');
  assert.match(text, /"userId":\d+,"name":"ayse","kind":"voice"/);
  await call(`/api/convos/${dm}/read`, { cookie: ayse.cookie, method: 'POST' });
  await until('"type":"read"');
  await call('/api/homework', { cookie: hoca.cookie, json: { classId: class9a.id, subject: 'Kimya', title: 'Deney raporu', due: '2099-03-01' } });
  await until('"type":"homework"');
  await call('/api/notes', { cookie: hoca.cookie, json: { studentId: ali.id, subject: 'Kimya', level: 4, body: 'Harika rapor.' } });
  await until('"type":"note"');
  await reader.cancel();
  const list = await call('/api/convos', { cookie: ali.cookie });
  const member = list.data.find((c) => c.id === dm).members.find((m) => m.id === ayse.id);
  assert.ok(member.lastRead > 0);
  // Okunacak yeni bir şey yoksa tekrar duyurulmaz (gereksiz trafik olmasın).
  assert.equal((await call(`/api/convos/${dm}/read`, { cookie: ayse.cookie, method: 'POST' })).status, 200);
});

test('grup: ad değişir, kişi eklenir, üye çıkabilir; özel sohbette olmaz', async () => {
  const g = (await call('/api/convos', { cookie: ali.cookie, json: { userIds: [ayse.id, hoca.id], title: 'Eski' } })).data.id;
  assert.equal((await call(`/api/convos/${g}`, { cookie: ali.cookie, method: 'PATCH', json: { title: 'Öğrenci verdi' } })).status, 200);
  assert.equal((await call(`/api/convos/${g}`, { cookie: ayse.cookie, method: 'PATCH', json: { title: 'Yeni' } })).status, 200);
  const extra = await register('ekstra', 'teacher', '9-A');
  assert.equal((await call(`/api/convos/${g}/members`, { cookie: ali.cookie, json: { userIds: [extra.id] } })).status, 200);
  const seen = (await call('/api/convos', { cookie: extra.cookie })).data.find((c) => c.id === g);
  assert.equal(seen.title, 'Yeni');
  assert.equal(seen.members.length, 4);
  assert.equal((await call(`/api/convos/${g}/members/me`, { cookie: hoca.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/convos/${g}/messages`, { cookie: hoca.cookie })).status, 404);
  assert.equal((await call(`/api/convos/${dm}`, { cookie: ali.cookie, method: 'PATCH', json: { title: 'x' } })).status, 400);
  assert.equal((await call(`/api/convos/${dm}/members/me`, { cookie: ali.cookie, method: 'DELETE' })).status, 400);
  assert.equal((await call(`/api/convos/${g}/members`, { cookie: can.cookie, json: { userIds: [can.id] } })).status, 404);
});

test('son üye çıkınca grup mesajları ve dosyalarıyla silinir', async () => {
  const g = (await call('/api/convos', { cookie: hoca.cookie, json: { userIds: [ayse.id, hoca2.id], title: 'Geçici' } })).data.id;
  const photo = (await call(`/api/convos/${g}/images`, { cookie: hoca.cookie, body: PNG })).data.image;
  const file = path.join(dir, 'uploads', photo);
  const leave = (cookie) => call(`/api/convos/${g}/members/me`, { cookie, method: 'DELETE' });
  assert.equal((await leave(hoca.cookie)).status, 200);
  assert.equal((await leave(ayse.cookie)).status, 200);
  assert.ok(fs.existsSync(file)); // hoca2 hâlâ üye
  assert.equal((await leave(hoca2.cookie)).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(file));
  assert.equal((await call(`/api/convos/${g}/messages`, { cookie: hoca2.cookie })).status, 404);
});

test('mesaj silme: herkes kendi mesajını, öğretmen öğrencinin mesajını siler; dosya da gider', async () => {
  const del = (cookie, id, convo = dm) => call(`/api/convos/${convo}/messages/${id}`, { cookie, method: 'DELETE' });
  const fromAli = (await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body: 'yanlışlıkla' } })).data;
  const fromAyse = (await call(`/api/convos/${dm}/messages`, { cookie: ayse.cookie, json: { body: 'öğretmen yazdı' } })).data;
  assert.equal((await del(ali.cookie, fromAyse.id)).status, 404); // öğrenci öğretmenin mesajını silemez
  assert.equal((await del(hoca.cookie, fromAli.id)).status, 404); // sohbetin üyesi olmayan silemez
  assert.equal((await del(ayse.cookie, fromAli.id)).status, 200);
  assert.equal((await del(ali.cookie, fromAli.id)).status, 404);
  const photo = (await call(`/api/convos/${dm}/images`, { cookie: ali.cookie, body: PNG })).data;
  assert.equal((await del(ali.cookie, photo.id)).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(path.join(dir, 'uploads', photo.image)));
  const left = (await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie })).data.map((m) => m.id);
  assert.ok(!left.includes(fromAli.id) && !left.includes(photo.id) && left.includes(fromAyse.id));
});

test('hesap silme şifre ister, girişi kapatır, mesajlar kalır', async () => {
  const u = await register('silinecek');
  const convo = (await call('/api/convos', { cookie: u.cookie, json: { userIds: [hoca.id] } })).data.id;
  await call(`/api/convos/${convo}/messages`, { cookie: u.cookie, json: { body: 'veda' } });
  assert.equal((await call('/api/me', { cookie: u.cookie, method: 'DELETE', json: { password: 'yanlis-sifre' } })).status, 403);
  const del = await call('/api/me', { cookie: u.cookie, method: 'DELETE', json: { password: PASSWORD } });
  assert.equal(del.status, 200);
  assert.equal((await call('/api/me', { cookie: u.cookie })).status, 401);
  assert.equal((await call('/api/login', { json: { username: 'silinecek', password: PASSWORD } })).status, 401);
  const msgs = await call(`/api/convos/${convo}/messages`, { cookie: hoca.cookie });
  assert.equal(msgs.data.at(-1).body, 'veda');
  assert.ok(!(await call('/api/users', { cookie: hoca.cookie })).data.some((x) => x.id === u.id));
});

test('aşırı büyük yükleme reddedilir', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
  assert.equal((await call(`/api/convos/${dm}/images`, { cookie: ali.cookie, body: big })).status, 413);
});

test('başka siteden gelen yazma isteği reddedilir', async () => {
  const r = await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body: 'x' }, headers: { Origin: 'https://kotu.example' } });
  assert.equal(r.status, 403);
});

test('mesaj canlı akışla yalnızca üyelere ulaşır', async () => {
  const open = (cookie) => fetch(`${BASE}/api/events`, { headers: { Cookie: cookie } });
  const [mine, outsider] = await Promise.all([open(ayse.cookie), open(can.cookie)]);
  const readUntil = async (res, needle) => {
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString();
    }
    return { text, reader };
  };
  await call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body: 'canli-mesaj' } });
  const got = await readUntil(mine, 'canli-mesaj');
  assert.ok(got.text.includes('canli-mesaj'));
  await got.reader.cancel();
  const chunk = await Promise.race([
    outsider.body.getReader().read().then((r) => Buffer.from(r.value).toString()),
    new Promise((r) => setTimeout(() => r(''), 300)),
  ]);
  assert.ok(!chunk.includes('canli-mesaj'));
});

test('şifre değişince diğer oturumlar kapanır', async () => {
  const u = await register('sifreci');
  const other = await call('/api/login', { json: { username: 'sifreci', password: PASSWORD } });
  assert.equal((await call('/api/me', { cookie: u.cookie, method: 'PATCH', json: { newPassword: 'yeni-parola-1', currentPassword: 'yanlis' } })).status, 403);
  assert.equal((await call('/api/me', { cookie: u.cookie, method: 'PATCH', json: { newPassword: 'yeni-parola-1', currentPassword: PASSWORD } })).status, 200);
  assert.equal((await call('/api/me', { cookie: other.cookie })).status, 401);
  assert.equal((await call('/api/me', { cookie: u.cookie })).status, 200);
  assert.equal((await call('/api/login', { json: { username: 'sifreci', password: PASSWORD } })).status, 401);
});

test('art arda hatalı giriş hesabı geçici kilitler', async () => {
  await register('kilitli');
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('/api/login', { json: { username: 'kilitli', password: 'yanlis' } })).status, 401);
  }
  const locked = await call('/api/login', { json: { username: 'kilitli', password: PASSWORD } });
  assert.equal(locked.status, 429);
  // Kilit yalnızca deneyen adrese konur; hesabın sahibi başka adresten girebilir.
  const owner = await call('/api/login', { json: { username: 'kilitli', password: PASSWORD }, headers: { 'X-Forwarded-For': '10.0.0.5' } });
  assert.equal(owner.status, 200);
});

test('yönetici şifre sıfırlar ve üye çıkarır', async () => {
  const u = await register('giden');
  const temp = /password: (\S+)/.exec(cli('reset', 'giden'))[1];
  assert.equal((await call('/api/me', { cookie: u.cookie })).status, 401);
  const login = await call('/api/login', { json: { username: 'giden', password: temp } });
  assert.equal(login.status, 200);
  cli('remove', 'giden');
  assert.equal((await call('/api/me', { cookie: login.cookie })).status, 401);
  assert.equal((await call('/api/login', { json: { username: 'giden', password: temp } })).status, 401);
});

test('bildirim: yalnızca bilinen servis, gönderene gitmez, imza geçerli, ölü abonelik silinir', async () => {
  const crypto = require('node:crypto');
  const sub = (cookie, name) => call('/api/push', { cookie, json: { endpoint: `${FAKE_PUSH}/${name}` } });
  const waitHit = async () => {
    for (let i = 0; i < 100 && !pushHits.length; i++) await new Promise((r) => setTimeout(r, 20));
  };
  const say = (body) => call(`/api/convos/${dm}/messages`, { cookie: ali.cookie, json: { body } });

  assert.equal((await call('/api/push', { json: { endpoint: `${FAKE_PUSH}/x` } })).status, 401);
  for (const endpoint of ['https://kotu.example/x', 'http://169.254.169.254/latest', 'cop']) {
    assert.equal((await call('/api/push', { cookie: ali.cookie, json: { endpoint } })).status, 400, endpoint);
  }
  assert.equal((await sub(ayse.cookie, 'ayse')).status, 200);
  assert.equal((await sub(ali.cookie, 'ali')).status, 200);
  assert.equal((await sub(can.cookie, 'can')).status, 200);

  pushHits.length = 0;
  await say('bildirim-1');
  await waitHit();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(pushHits.map((x) => x.url), ['/ayse']); // gönderen ve üye olmayan alamaz

  const { key } = (await call('/api/push-key', { cookie: ali.cookie })).data;
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(pushHits[0].headers.authorization);
  assert.equal(k, key);
  const [head, claims, signature] = jwt.split('.');
  const raw = Buffer.from(key, 'base64url');
  const publicKey = crypto.createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
  });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(payload.aud, FAKE_PUSH);
  assert.ok(payload.exp > Date.now() / 1000);

  // Servis 410 derse abonelik silinir, sonraki mesajda istek gitmez.
  pushStatus = 410;
  pushHits.length = 0;
  await say('bildirim-2');
  await waitHit();
  await new Promise((r) => setTimeout(r, 100));
  pushStatus = 201;
  pushHits.length = 0;
  await say('bildirim-3');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pushHits.length, 0);

  // Çıkışta silinen abonelik de bildirim almaz; başkasının aboneliği silinemez.
  await sub(ayse.cookie, 'ayse');
  await call('/api/push', { cookie: can.cookie, method: 'DELETE', json: { endpoint: `${FAKE_PUSH}/ayse` } });
  await say('bildirim-4');
  await waitHit();
  assert.deepEqual(pushHits.map((x) => x.url), ['/ayse']);
  await call('/api/push', { cookie: ayse.cookie, method: 'DELETE', json: { endpoint: `${FAKE_PUSH}/ayse` } });
  pushHits.length = 0;
  await say('bildirim-5');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pushHits.length, 0);
});

test('çeviri: iki dil eşit, kullanılan tüm anahtarlar ve sunucu hata kodları tanımlı', () => {
  const vm = require('node:vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const { en, tr } = vm.runInNewContext(`${read('public/i18n.js')};I18N`, { localStorage: { getItem: () => null } });
  assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.ok(en[key] && tr[key], key);

  const html = read('public/index.html');
  const used = [...html.matchAll(/data-i18n(?:-\w+)?="(\w+)"/g)].map((m) => m[1]);
  used.push(...[...read('public/app.js').matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]));
  used.push('student', 'teacher', 'level1', 'level2', 'level3', 'level4'); // app.js'de değişkenle seçilir
  const codes = [...read('server.js').matchAll(/HttpError\(\d+, '(\w+)'\)/g)].map((m) => `err.${m[1]}`);
  assert.ok(used.length > 60 && codes.length > 20);
  for (const key of [...used, ...codes, 'err.serverError']) assert.ok(key in en, key);
  // Arayüzde çevrilmemiş Türkçe metin kalmasın.
  assert.ok(!/[çğıİöşüÇĞÖŞÜ]/.test(html.replace(/<!--[\s\S]*?-->/g, '')));
});

test('bildirim yazısı kayıt adresindeki dili izler, uygulama ekrandaysa gösterilmez', async () => {
  const vm = require('node:vm');
  const code = fs.readFileSync(path.join(__dirname, 'public/sw.js'), 'utf8');
  const fire = async (search, state) => {
    const handlers = {};
    const shown = [];
    vm.runInNewContext(code, {
      URLSearchParams,
      self: { location: { search }, addEventListener: (name, fn) => { handlers[name] = fn; } },
      clients: { matchAll: async () => [{ visibilityState: state }] },
      registration: { showNotification: async (title, options) => shown.push(`${title}: ${options.body}`) },
    });
    let done;
    handlers.push({ waitUntil: (p) => { done = p; } });
    await done;
    return shown;
  };
  assert.deepEqual(await fire('?lang=tr', 'hidden'), ['EDUCOM: Yeni bir bildirimin var']);
  assert.deepEqual(await fire('?lang=en', 'hidden'), ['EDUCOM: You have something new']);
  assert.deepEqual(await fire('', 'hidden'), ['EDUCOM: Yeni bir bildirimin var']);
  assert.deepEqual(await fire('?lang=tr', 'visible'), []);
});

test('yedek veritabanını ve fotoğrafları içerir', async () => {
  const target = path.join(dir, 'yedekler');
  const out = cli('backup', target);
  const made = /Backup saved: (.+)/.exec(out)[1].trim();
  assert.ok(fs.statSync(path.join(made, 'educom.db')).size > 0);
  assert.ok(fs.readdirSync(path.join(made, 'uploads')).length >= 1);
});

test('öğrenci başka sınıfa taşınır, eski sınıf grubundan çıkar', async () => {
  const u = await register('tasinan', 'student', '9-A');
  assert.throws(() => cli('move', 'tasinan', '10-B', '11-C')); // öğrencinin tek sınıfı olur
  assert.match(cli('move', 'tasinan', '10-B'), /now in 10-B/);
  const classes = (await call('/api/me', { cookie: u.cookie })).data.classes.map((c) => c.name);
  assert.deepEqual(classes, ['10-B']);
  assert.equal((await call(`/api/convos/${class9a.convoId}/messages`, { cookie: u.cookie })).status, 404);
  assert.match(cli('move', 'hoca2', '11-C', '12-C'), /11-C, 12-C/);
});

test('eski fotoğraf ve sesler süreyle silinir', async () => {
  assert.throws(() => cli('prune', 'x'));
  assert.match(cli('prune', '1'), /^0 photos/); // hepsi bugünden
});

// Herkesin sınıfını değiştirdiği için en sonda çalışır.
test('yıl sonu: önce plan gösterilir; --yes ile öğrenciler bir üst sınıfa geçer, 12. sınıflar mezun olur', async () => {
  const mezun = await register('mezun', 'student', '12-A');
  const plan = cli('promote');
  assert.match(plan, /9-A -> 10-A: \d+ students/);
  assert.match(plan, /12-A -> graduated/);
  assert.equal((await call('/api/me', { cookie: ali.cookie })).data.classes[0].name, '9-A'); // plan bir şey değiştirmez
  cli('promote', '--yes');
  assert.equal((await call('/api/me', { cookie: ali.cookie })).data.classes[0].name, '10-A');
  assert.equal((await call('/api/me', { cookie: veli.cookie })).data.classes[0].name, '11-B');
  assert.equal((await call('/api/me', { cookie: mezun.cookie })).status, 401);
  assert.ok((await call('/api/me', { cookie: hoca.cookie })).data.classes.some((c) => c.name === '9-A')); // öğretmen yerinde
});
