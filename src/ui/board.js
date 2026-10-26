import {Box, Text} from 'ink';
import {html, fit, link} from './components.js';
import {THEME, PR_STYLE, statusWord, pickPr, formatAge} from '../model.js';
import {LANES} from '../board.js';

const LANE_COLOR = {
  me: THEME.warning, dev: THEME.claude, cr: THEME.suggestion, ready: THEME.success,
  others: THEME.inactive, released: THEME.success, done: THEME.inactive,
};
const MIN_LANE = 26;
const CARD_ROWS = 6;

function Card({session, statuses, selected, width, now}) {
  const st = statusWord(session);
  const pr = pickPr(session, statuses);
  const inner = width - 2;
  const pin = session.pinned ? ' 📌' : '';
  const age = formatAge(session.updatedAt, now);
  const prMark = pr ? `${link(pr.href, PR_STYLE[pr.color].emoji)} ` : '';
  const left = inner - age.length - 1 - (pr ? 3 : 0);
  return html`<${Box} flexDirection="column" width=${width} borderStyle="round" borderColor=${selected ? THEME.claude : 'gray'} borderDimColor=${!selected}>
    <${Text} bold=${selected} wrap="truncate">${fit(session.name, inner - pin.length - 1)}${pin}<//>
    <${Text} wrap="truncate">${prMark}<${Text} color=${st.word === 'Working' ? THEME.claude : st.color} dimColor=${st.dim}>${fit(st.word, Math.max(1, left))}<//> <${Text} dimColor>${age}<//><//>
    <${Text} dimColor wrap="truncate">${fit(session.detail || ' ', inner)}<//>
    <${Text} color=${THEME.suggestion} dimColor wrap="truncate">${fit(session.group ? `«${session.group}»` : ' ', inner)}<//>
  <//>`;
}

// lanes: {key: [session…]} from boardLanes; sel: [lane index, card index].
export function Board({lanes, sel, statuses, cols, room, now}) {
  const fitting = Math.max(1, Math.floor((cols + 1) / (MIN_LANE + 1)));
  const shown = Math.min(LANES.length, fitting);
  const width = Math.floor((cols + 1) / shown) - 1;
  // Scroll sideways only as far as needed to keep the selected lane on screen.
  const start = Math.max(0, Math.min(sel[0] - shown + 1, LANES.length - shown));
  const perLane = Math.max(1, Math.floor((room - 2) / CARD_ROWS));
  const visible = LANES.slice(start, start + shown);
  return html`<${Box} flexDirection="column">
    <${Box}>
      ${visible.map((lane, k) => {
        const i = start + k;
        const cards = lanes[lane.key];
        const selectedHere = sel[0] === i ? sel[1] : -1;
        const offset = selectedHere >= perLane ? selectedHere - perLane + 1 : 0;
        const slice = cards.slice(offset, offset + perLane);
        const more = cards.length - offset - slice.length;
        return html`<${Box} key=${lane.key} flexDirection="column" width=${width} marginRight=${k < visible.length - 1 ? 1 : 0}>
          <${Text} bold color=${LANE_COLOR[lane.key]} wrap="truncate">${lane.title} <${Text} dimColor>${cards.length}${offset ? ` · ↑${offset}` : ''}<//><//>
          ${slice.map((s, j) => html`<${Card} key=${s.id} session=${s} statuses=${statuses} selected=${selectedHere === offset + j} width=${width} now=${now} />`)}
          ${more > 0 ? html`<${Text} dimColor>  ↓ ${more} more<//>` : null}
          ${!cards.length ? html`<${Text} dimColor>  —<//>` : null}
        <//>`;
      })}
    <//>
    ${start > 0 || start + shown < LANES.length ? html`<${Text} dimColor>${start > 0 ? '◀ ' : '  '}${LANES.length - shown} more lane(s) off screen${start + shown < LANES.length ? ' ▶' : ''}<//>` : null}
  <//>`;
}
