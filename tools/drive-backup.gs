/**
 * ШГА Биелэлт — Google Drive руу өдөр бүр хуулах (нөөцлөх) скрипт.
 * 1) Firebase-ийн бүх мэдээг JSON файлаар «Бүрэн хуулбар» хавтсанд хадгална.
 * 2) Нэгж бүрийн хавтсанд «Мэдээ — ШГА..» хүснэгт: төлөвлөгөө бүр нэг хуудас, мөр бүр нэг хугацаа.
 * 3) «Нэгтгэл — бүх нэгж» хүснэгт: төлөвлөгөө бүр нэг хуудас, бүх нэгж, бүх хугацаа.
 * 4) Судалгаанд хавсаргасан файлуудыг нэгжийн «Судалгаа» хавтсанд хадгална.
 * Анх ажиллуулахдаа setup функцийг Run хийнэ (өдөр бүр 02:00 цагт автоматаар ажиллана).
 * 6 минутын хязгаараас хэтрэхгүйн тулд нэгжүүдийг хэсэгчлэн бичиж, үлдсэнийг 1 минутын дараа үргэлжлүүлнэ.
 * Юу ч устгадаггүй: өдрийн JSON хуулбарыг 60 хоног, сар бүрийн 1-ний хуулбарыг үүрд хадгална
 * (60 хоногоос хуучин өдрийн хуулбар Хогийн сав руу орно, 30 хоног сэргээх боломжтой).
 */
var FB = 'https://shga-bilelt-default-rtdb.firebaseio.com';
var ROOT_NAME = 'ШГА Биелэлт';
var OLD_ARCHIVE_ID = '1Kf86zsEcktOsv0ktqT0N8OXQdHaFsrKR'; // «ШГА Биелэлт — Архив 2026» хавтас
var KEEP_DAILY = 60;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'dailyBackup' || h === 'continueBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).inTimezone('Asia/Ulaanbaatar').create();
  var root = root_();
  try { DriveApp.getFolderById(OLD_ARCHIVE_ID).moveTo(root); } catch (e) {}
  dailyBackup();
}

// 1-р алхам: бүрэн JSON хуулбар (хурдан), дараа нь хүснэгтүүдийг хэсэгчлэн бичнэ
function dailyBackup() {
  var root = root_();
  var today = Utilities.formatDate(new Date(), 'Asia/Ulaanbaatar', 'yyyy-MM-dd');
  var res = UrlFetchApp.fetch(FB + '/.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Firebase уншиж чадсангүй: ' + res.getResponseCode());
  var raw = res.getContentText();
  var db = JSON.parse(raw || '{}') || {};
  if (!db.data && !db.config) throw new Error('Firebase хоосон ирлээ — хуулбар хийсэнгүй');
  var full = folder_(root, 'Бүрэн хуулбар (өдөр бүр)');
  var fname = 'SGA_' + today + '.json';
  var ex = full.getFilesByName(fname);
  while (ex.hasNext()) ex.next().setTrashed(true);
  var file = full.createFile(fname, raw, 'application/json');
  cleanup_(full);
  var p = PropertiesService.getScriptProperties();
  p.setProperties({ JOB_FILE: file.getId(), JOB_STAGE: 'units', JOB_IDX: '0', JOB_DAY: today });
  work_();
}

function continueBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'continueBackup') ScriptApp.deleteTrigger(t); });
  work_();
}

function work_() {
  var start = Date.now(), LIMIT = 4.5 * 60 * 1000;
  var p = PropertiesService.getScriptProperties();
  var stage = p.getProperty('JOB_STAGE');
  if (!stage || stage === 'done') return;
  var db = JSON.parse(DriveApp.getFileById(p.getProperty('JOB_FILE')).getBlob().getDataAsString() || '{}');
  var root = root_();
  var m = model_(db);
  if (stage === 'units') {
    var idx = parseInt(p.getProperty('JOB_IDX') || '0', 10);
    var unitsFolder = folder_(root, 'Нэгжүүд');
    while (idx < m.units.length) {
      if (Date.now() - start > LIMIT) { p.setProperty('JOB_IDX', String(idx)); later_(); return; }
      writeUnit_(unitsFolder, m, m.units[idx]);
      idx++; p.setProperty('JOB_IDX', String(idx));
    }
    stage = 'all'; p.setProperty('JOB_STAGE', stage);
  }
  if (stage === 'all') {
    if (Date.now() - start > LIMIT) { later_(); return; }
    writeAll_(root, m);
    stage = 'survey'; p.setProperty('JOB_STAGE', stage);
  }
  if (stage === 'survey') {
    if (Date.now() - start > LIMIT) { later_(); return; }
    writeSurveys_(root, db);
    SpreadsheetApp.flush();
    p.setProperty('JOB_STAGE', 'done');
    p.setProperty('LAST_OK', p.getProperty('JOB_DAY') + ' ' + Utilities.formatDate(new Date(), 'Asia/Ulaanbaatar', 'HH:mm'));
  }
}

function later_() {
  ScriptApp.newTrigger('continueBackup').timeBased().after(60 * 1000).create();
}

function root_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('ROOT');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var r = folder_(DriveApp.getRootFolder(), ROOT_NAME);
  p.setProperty('ROOT', r.getId());
  return r;
}

function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function cleanup_(full) {
  var files = [], it = full.getFiles();
  while (it.hasNext()) { var f = it.next(); var m = f.getName().match(/^SGA_(\d{4}-\d{2}-(\d{2}))\.json$/); if (m) files.push({ f: f, d: m[1], day: m[2] }); }
  files.sort(function (a, b) { return a.d < b.d ? 1 : -1; });
  files.forEach(function (x, i) { if (i >= KEEP_DAILY && x.day !== '01') x.f.setTrashed(true); });
}

function periodKey_(p) {
  var n = String(p || '').match(/\d+/g) || [];
  return n.map(function (x) { return ('0000' + x).slice(-4); }).join('');
}

function val_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return v.name || JSON.stringify(v);
  var s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return Number(s.replace(/,/g, ''));
  return s;
}

function safeName_(s) {
  return String(s).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 95) || 'Хуудас';
}

function spreadsheet_(folder, name, key) {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty(key), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); if (DriveApp.getFileById(id).isTrashed()) ss = null; } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    p.setProperty(key, ss.getId());
  }
  return ss;
}

function writeSheet_(ss, title, rows) {
  var name = safeName_(title);
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var w = 0; rows.forEach(function (r) { if (r.length > w) w = r.length; });
  var data = rows.map(function (r) { var x = r.slice(); while (x.length < w) x.push(''); return x; });
  if (data.length && w) {
    sh.getRange(1, 1, data.length, w).setValues(data);
    sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#E6FAF7').setWrap(true);
    sh.setFrozenRows(1);
  }
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Хуудас1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
}

function model_(db) {
  var inds = (db.config && db.config.indicators) || [];
  var nameOf = {};
  inds.forEach(function (i) { if (i && i.id) nameOf[i.id] = i.name; });
  var data = Object.keys(db.data || {}).map(function (k) { return db.data[k]; }).filter(function (e) { return e && e.unit; });
  var plans = {};
  data.forEach(function (e) { plansOf_(e).forEach(function (p) { (plans[p] = plans[p] || []).push(e); }); });
  var cols = {};
  Object.keys(plans).forEach(function (p) {
    var mine = inds.filter(function (i) { return (i.plans || []).indexOf(p) >= 0; }).map(function (i) { return i.id; });
    var used = {}; plans[p].forEach(function (e) { Object.keys(e.values || {}).forEach(function (k) { var v = e.values[k]; if (v !== '' && v !== null && v !== undefined) used[k] = 1; }); });
    var c = mine.filter(function (id) { return used[id]; });
    if (!c.length) c = Object.keys(used);
    cols[p] = c;
  });
  var byUnit = {};
  data.forEach(function (e) { (byUnit[e.unit] = byUnit[e.unit] || []).push(e); });
  return { nameOf: nameOf, plans: plans, cols: cols, byUnit: byUnit, units: Object.keys(byUnit).sort() };
}
function plansOf_(e) { return (e.plans && e.plans.length) ? e.plans : ['Төлөвлөгөөгүй']; }
function sortE_(a, b) { var x = periodKey_(a.period), y = periodKey_(b.period); return x < y ? -1 : x > y ? 1 : 0; }
function row_(m, e, p) { return [e.period || '', e.freq || '', e.date || ''].concat(m.cols[p].map(function (id) { return val_(e.values && e.values[id]); })); }
function head_(m, p) { return ['Хугацаа', 'Давтамж', 'Илгээсэн огноо'].concat(m.cols[p].map(function (id) { return m.nameOf[id] || id; })); }

function writeUnit_(unitsFolder, m, u) {
  var es = m.byUnit[u];
  var uname = ''; es.forEach(function (e) { if (e.unitName) uname = e.unitName; });
  var uf = folder_(unitsFolder, u + (uname ? ' · ' + uname : ''));
  var ss = spreadsheet_(uf, 'Мэдээ — ' + u + (uname ? ' · ' + uname : ''), 'SS_' + u);
  Object.keys(m.plans).forEach(function (p) {
    var rows = es.filter(function (e) { return plansOf_(e).indexOf(p) >= 0; }).sort(sortE_);
    if (!rows.length) return;
    writeSheet_(ss, p, [head_(m, p)].concat(rows.map(function (e) { return row_(m, e, p); })));
  });
}

function writeAll_(root, m) {
  var all = spreadsheet_(root, 'Нэгтгэл — бүх нэгж', 'SS_ALL');
  Object.keys(m.plans).forEach(function (p) {
    var rows = m.plans[p].slice().sort(function (a, b) { var s = sortE_(a, b); return s || (a.unit < b.unit ? -1 : 1); });
    writeSheet_(all, p, [['Нэгж', 'Нэгжийн нэр'].concat(head_(m, p))].concat(rows.map(function (e) { return [e.unit, e.unitName || ''].concat(row_(m, e, p)); })));
  });
}

function writeSurveys_(root, db) {
  var sv = db.survey || {};
  var act = sv.active || {}, resp = sv.responses || {};
  var unitsFolder = folder_(root, 'Нэгжүүд');
  var rows = [['Судалгаа', 'Нэгж', 'Нэгжийн нэр', 'Илгээсэн огноо', 'Асуулт', 'Хариулт']];
  Object.keys(resp).forEach(function (sid) {
    var s = act[sid] || {}; var title = s.title || s.name || sid;
    var qs = {}; (s.questions || []).forEach(function (q) { if (q) qs[q.id] = q.text || q.id; });
    var byU = resp[sid] || {};
    Object.keys(byU).forEach(function (u) {
      var r = byU[u] || {}; var vals = r.values || {};
      Object.keys(vals).forEach(function (qid) {
        var v = vals[qid];
        if (v && typeof v === 'object' && v.data) {
          rows.push([title, u, r.unitName || '', r.date || '', qs[qid] || qid, 'Файл: ' + (v.name || '')]);
          try {
            var uname = r.unitName || '';
            var uf = folder_(unitsFolder, u + (uname ? ' · ' + uname : ''));
            var sf = folder_(folder_(uf, 'Судалгаа'), safeName_(title));
            var fn = v.name || (qid + '.bin');
            if (!sf.getFilesByName(fn).hasNext()) {
              var m = String(v.data).match(/^data:([^;]+);base64,(.*)$/);
              if (m) sf.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], fn));
            }
          } catch (e) {}
        } else {
          rows.push([title, u, r.unitName || '', r.date || '', qs[qid] || qid, val_(v)]);
        }
      });
    });
  });
  if (rows.length > 1) writeSheet_(spreadsheet_(root, 'Нэгтгэл — бүх нэгж', 'SS_ALL'), 'Судалгааны хариулт', rows);
}
