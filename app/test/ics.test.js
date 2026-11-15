import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-ics-'));
const { openDb } = await import('../server/db.js');
const { fetchIcs, createEvent, resyncIcs } = await import('../server/routes/party.js');

const ics = (dentistStart) => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly@test
DTSTART:20261201T170000Z
DTEND:20261201T180000Z
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Climbing
END:VEVENT
BEGIN:VEVENT
UID:dentist@test
DTSTART:${dentistStart}
DTEND:20261210T110000Z
SUMMARY:Dentist
DESCRIPTION:Root canal
LOCATION:Main St 1
END:VEVENT
END:VCALENDAR`;

test('iCal feed: recurrence expansion, share redacted, resync moves events', async () => {
  let body = ics('20261210T100000Z');
  const srv = http.createServer((_q, r) => r.end(body)).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/basic.ics`;
  try {
    const list = await fetchIcs(url, new Date('2026-11-30'), new Date('2026-12-31'));
    assert.deepEqual(list.map((e) => e.title), ['Climbing', 'Climbing', 'Dentist', 'Climbing']);
    assert.equal(list[2].location, 'Main St 1');

    const db = openDb(':memory:');
    db.prepare("INSERT INTO users(id, username, display_name, password_hash, ics_url) VALUES(1,'a','a','x',?)").run(url);
    db.prepare("INSERT INTO campaigns(id, name, invite_code) VALUES(1,'p','C')").run();
    db.prepare("INSERT INTO campaign_members VALUES(1,1,'dm')").run();
    const user = { id: 1 };
    const dentist = list[2];
    const { id } = createEvent(db, user, 1, { ...dentist, redacted: true, source_uid: dentist.uid });
    let row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    assert.deepEqual([row.title, row.description, row.location], ['Busy', '', '']);

    body = ics('20261210T090000Z'); // dentist moved an hour earlier
    assert.deepEqual(await resyncIcs(db, user, 1), { updated: 1, removed: 0 });
    row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    assert.equal(row.start, '2026-12-10T09:00:00.000Z');
    assert.equal(row.title, 'Busy', 'still redacted after resync');
  } finally { srv.close(); }
});
