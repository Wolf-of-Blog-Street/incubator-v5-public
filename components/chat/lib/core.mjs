// Fleet chat: the pure rules. Who a message goes to, and how a session is named. See design fleet-chat.md.

/** A session's key: seat/handle. */
export const keyOf = s => `${s.seat}/${s.handle}`;

/** "@seat", "@seat/context", "@seat/handle", "@handle" and "#channel" are the addresses. */
const ADDRESS = /^[@#][a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)?$/i;
export const validAddress = a => ADDRESS.test(String(a || ''));

/** @-mentions in a message body. An @ right after a letter or digit is an email address, not a mention. */
export function mentionsIn(text) {
  return [...String(text || '').matchAll(/(^|[^A-Za-z0-9_.@])@([a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)?)/gi)]
    .map(m => '@' + m[2].replace(/[.]+$/, ''));
}

/**
 * The sessions an @address names. "@x/y": seat x, then handle y or context y. "@x": the sessions
 * whose handle is x; else the one of seat x seen most recently. Case does not matter.
 */
export function resolve(address, sessions) {
  const [head, tail] = String(address).slice(1).toLowerCase().split('/');
  const lc = v => String(v || '').toLowerCase();
  const isSeat = s => lc(s.seat) === head || lc(s.seat).replace(/-pm$/, '') === head; // @agent-f is seat agent-f-pm
  if (tail) {
    const seat = sessions.filter(isSeat);
    const byHandle = seat.filter(s => lc(s.handle) === tail);
    return byHandle.length ? byHandle : seat.filter(s => lc(s.context).split(',').includes(tail));
  }
  const byHandle = sessions.filter(s => lc(s.handle) === head && lc(s.handle) !== 'lead');
  if (byHandle.length) return byHandle;
  const seat = sessions.filter(isSeat).sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
  return seat.slice(0, 1);
}

/** Every session a message pings: its @address, the @mentions in its text, the channel's subscribers. Never the sender. */
export function recipients(msg, sessions) {
  const out = new Map();
  const add = list => list.forEach(s => out.set(keyOf(s), s));
  if (String(msg.to).startsWith('@')) add(resolve(msg.to, sessions));
  else add(sessions.filter(s => (s.subscriptions || []).includes(msg.to)));
  for (const m of mentionsIn(msg.text)) add(resolve(m, sessions));
  out.delete(msg.from);
  return [...out.values()];
}

/** Whether a message is for this session: sent to it, mentioning it, or on a channel it follows. */
export const isFor = (msg, session, sessions) => recipients(msg, sessions).some(s => keyOf(s) === keyOf(session));

/** The line typed into a session's input box. */
export const deliveryText = msg =>
  `[chat ${msg.to} from @${msg.from}] ${String(msg.text).replace(/\s*\n\s*/g, ' ')}  (reply: chat say @${msg.from} "...")`;
