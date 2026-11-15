import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4
const list = document.querySelector('[data-testid="incident-list"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('.status');
const rows = new Map(); // incident id -> <li>, so a refresh adds rows and never rebuilds the ones on screen

// R5: the viewer's own time zone and date order (de-DE and en-GB give dd/mm, en-US gives mm/dd).
const fmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  li.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, fmt.format(new Date(i.openedAt))),
  );
  const cell = el('span', { class: 'take' });
  const btn = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
  // Product's decision (step one): Ack asks to confirm first, and the confirm names the incident the click hit.
  btn.addEventListener('click', () => askToAck(i.id, async () => {
    btn.disabled = true;
    try {
      const r = await ack(i.id); // R2
      btn.replaceWith(el('span', { 'data-testid': 'acked', class: 'acked', title: r.ackedAt }, `acked ${fmt.format(new Date(r.ackedAt))}`));
      li.classList.add('is-acked');
    } catch (e) {
      btn.disabled = false;
      show(`ack ${i.id} failed: ${e.message}`);
    }
  }));
  cell.append(btn);
  li.append(cell);
  return li;
}

// The confirm: one at a time, named by incident id, fixed on screen so the moving list can't shift it.
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmText = confirmBox.querySelector('.confirm-text');
let pending = null;
function askToAck(id, run) {
  pending = run;
  confirmText.textContent = `Ack ${id}?`;
  confirmBox.dataset.id = id;
  confirmBox.hidden = false;
  confirmBox.querySelector('[data-testid="confirm-ack"]').focus();
}
function closeConfirm() { confirmBox.hidden = true; pending = null; delete confirmBox.dataset.id; }
confirmBox.querySelector('[data-testid="confirm-ack"]').addEventListener('click', () => { const run = pending; closeConfirm(); run?.(); });
confirmBox.querySelector('[data-testid="confirm-cancel"]').addEventListener('click', closeConfirm);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !confirmBox.hidden) closeConfirm(); });

// R1: new incidents go on top, newest first. The page is newest first, so insert from its oldest up.
function add(incidents) {
  for (const i of [...incidents].reverse()) {
    if (rows.has(i.id)) continue;
    const li = row(i);
    rows.set(i.id, li);
    list.prepend(li);
  }
  empty.hidden = rows.size > 0;
}

function show(msg) { status.textContent = msg; status.hidden = !msg; }

async function tick() {
  try {
    const page = await fetchIncidents();
    add(page.incidents);
    document.querySelector('[data-testid="loader"]')?.remove(); // R3: gone once incidents load
    show('');
  } catch (e) {
    show(`could not load incidents: ${e.message}`);
  }
  setTimeout(tick, REFRESH_MS); // R4: one request at a time, 2 s after the last answer
}

tick();
